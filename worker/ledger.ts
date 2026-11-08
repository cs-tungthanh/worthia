import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { computePosition, type PositionMovement } from "../shared/position";
import type { AppEnv } from "./auth";

// Holdings are computed from share movements (buys, sells, bonus issues): see shared/position.ts.
// `stocks` only gives each user+symbol a stable id for dividends to point at.

type MovementRow = {
  id: number;
  symbol: string;
  date: string;
  kind: "buy" | "sell" | "bonus";
  quantity: number;
  balance: number | null;
  price: number | null;
  fee: number | null;
  tax: number | null;
  trade_date: string | null;
  source: "statement" | "manual";
  origin: "securities" | "cash" | null; // see migrations/0006_movement_origin.sql
};

const COLUMNS = "id, symbol, date, kind, quantity, balance, price, fee, tax, trade_date, source, origin";

const byDateThenId = (a: MovementRow, b: MovementRow) => a.date.localeCompare(b.date) || a.id - b.id;

async function loadMovements(db: D1Database, userId: number, symbol?: string) {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM stock_movements WHERE user_id = ?1 AND (?2 IS NULL OR symbol = ?2) ORDER BY symbol, date, id`,
    )
    .bind(userId, symbol ?? null)
    .all<MovementRow>();
  return results;
}

// Rejects a change that would sell more shares than were held at that point.
function overSoldMessage(symbol: string, rows: MovementRow[]): string | null {
  const sorted = [...rows].sort(byDateThenId);
  const { overSold } = computePosition(sorted as PositionMovement[]);
  if (!overSold) return null;
  const m = sorted[overSold.index];
  return `On ${m.date} you held ${overSold.held} ${symbol}, fewer than the ${m.quantity} sold.`;
}

const ensureHolding = (db: D1Database, userId: number, symbol: string) =>
  db.prepare("INSERT OR IGNORE INTO stocks (user_id, symbol, shares) VALUES (?, ?, 0)").bind(userId, symbol);

export const ledger = new Hono<AppEnv>();

// ---------- holdings ----------

ledger.get("/stocks", async (c) => {
  const db = c.env.DB;
  const [{ results: stocks }, movements] = await Promise.all([
    db
      .prepare("SELECT id, symbol FROM stocks WHERE user_id = ? ORDER BY symbol")
      .bind(c.var.user.id)
      .all<{ id: number; symbol: string }>(),
    loadMovements(db, c.var.user.id),
  ]);
  return c.json(
    stocks.map((s) => {
      const rows = movements.filter((m) => m.symbol === s.symbol);
      const p = computePosition(rows as PositionMovement[]);
      return {
        id: s.id,
        symbol: s.symbol,
        shares: p.shares,
        avg_price: p.avgCost,
        cost: p.cost,
        realised: p.realised,
        // Buys still missing a price in the current position (they make the cost unknown).
        unpriced: rows.filter((m) => m.kind === "buy" && m.price == null).length,
        // Trades known only from the cash statement: bonus shares may be missing until the securities one is imported.
        cash_only: rows.filter((m) => m.origin === "cash").length,
        first_date: rows[0]?.date ?? null,
      };
    }),
  );
});

// Deletes a holding with its whole history and dividends.
ledger.delete("/stocks/:id", zValidator("param", z.object({ id: z.coerce.number().int().positive() })), async (c) => {
  const db = c.env.DB;
  const stock = await db
    .prepare("SELECT symbol FROM stocks WHERE id = ? AND user_id = ?")
    .bind(c.req.valid("param").id, c.var.user.id)
    .first<{ symbol: string }>();
  if (!stock) return c.json({ error: "Not found" }, 404);
  await db.batch([
    db.prepare("DELETE FROM stock_movements WHERE user_id = ? AND symbol = ?").bind(c.var.user.id, stock.symbol),
    db.prepare("DELETE FROM stocks WHERE id = ? AND user_id = ?").bind(c.req.valid("param").id, c.var.user.id),
  ]);
  return c.body(null, 204);
});

// ---------- movements ----------

const money = z
  .number()
  .nonnegative()
  .nullish()
  .transform((v) => v ?? null);
const movementInput = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((s) => s.toUpperCase()),
  date: z.iso.date(),
  kind: z.enum(["buy", "sell", "bonus"]),
  quantity: z.number().positive(),
  price: money,
  fee: money,
  tax: money,
});

ledger.get("/movements", zValidator("query", z.object({ symbol: z.string().trim().max(20).optional() })), async (c) =>
  c.json(await loadMovements(c.env.DB, c.var.user.id, c.req.valid("query").symbol?.toUpperCase())),
);

// One transaction entered in the app.
ledger.post("/movements", zValidator("json", movementInput), async (c) => {
  const db = c.env.DB;
  const m = c.req.valid("json");
  const existing = await loadMovements(db, c.var.user.id, m.symbol);
  const draft: MovementRow = {
    ...m,
    id: Number.MAX_SAFE_INTEGER,
    balance: null,
    trade_date: null,
    source: "manual",
    origin: null,
  };
  const problem = overSoldMessage(m.symbol, [...existing, draft]);
  if (problem) return c.json({ error: problem }, 400);
  const [row] = await db.batch([
    db
      .prepare(
        `INSERT INTO stock_movements (user_id, symbol, date, kind, quantity, price, fee, tax, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual') RETURNING ${COLUMNS}`,
      )
      .bind(c.var.user.id, m.symbol, m.date, m.kind, m.quantity, m.price, m.fee, m.tax),
    ensureHolding(db, c.var.user.id, m.symbol),
  ]);
  return c.json(row.results[0], 201);
});

const idParam = zValidator("param", z.object({ id: z.coerce.number().int().positive() }));

// Edits a movement. Statement rows keep their date, type and shares (re-importing relies on them); only the
// price, fee and tax can change.
ledger.put("/movements/:id", idParam, zValidator("json", movementInput.omit({ symbol: true })), async (c) => {
  const db = c.env.DB;
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const current = await db
    .prepare(`SELECT ${COLUMNS} FROM stock_movements WHERE id = ? AND user_id = ?`)
    .bind(id, c.var.user.id)
    .first<MovementRow>();
  if (!current) return c.json({ error: "Not found" }, 404);
  if (
    current.source === "statement" &&
    (body.date !== current.date || body.kind !== current.kind || body.quantity !== current.quantity)
  ) {
    return c.json(
      { error: "Imported transactions keep their date, type and shares; only price, fee and tax can change." },
      400,
    );
  }
  const rows = (await loadMovements(db, c.var.user.id, current.symbol)).map((r) =>
    r.id === id ? { ...r, ...body } : r,
  );
  const problem = overSoldMessage(current.symbol, rows);
  if (problem) return c.json({ error: problem }, 400);
  const row = await db
    .prepare(
      `UPDATE stock_movements SET date = ?, kind = ?, quantity = ?, price = ?, fee = ?, tax = ?
       WHERE id = ? AND user_id = ? RETURNING ${COLUMNS}`,
    )
    .bind(body.date, body.kind, body.quantity, body.price, body.fee, body.tax, id, c.var.user.id)
    .first();
  return c.json(row);
});

ledger.delete("/movements/:id", idParam, async (c) => {
  const db = c.env.DB;
  const { id } = c.req.valid("param");
  const current = await db
    .prepare("SELECT symbol FROM stock_movements WHERE id = ? AND user_id = ?")
    .bind(id, c.var.user.id)
    .first<{ symbol: string }>();
  if (!current) return c.json({ error: "Not found" }, 404);
  const rows = (await loadMovements(db, c.var.user.id, current.symbol)).filter((r) => r.id !== id);
  const problem = overSoldMessage(current.symbol, rows);
  if (problem) return c.json({ error: `Can't delete: ${problem}` }, 400);
  await db.prepare("DELETE FROM stock_movements WHERE id = ? AND user_id = ?").bind(id, c.var.user.id).run();
  return c.body(null, 204);
});

// ---------- statement import ----------

// Securities-statement rows are matched on (symbol, settlement date, type, shares, balance after); a row already
// saved keeps it and gains any price, fee, tax or trade date the import now knows (from the cash statement).
// Cash-statement trade days without a securities row are saved as their own transactions (one per symbol, side
// and trade day); `remove` lists those that a securities row now replaces. The app works out all three
// (src/import/plan.ts); the server only applies them.
const IMPORT_COLUMNS = 11;
const ROWS_PER_INSERT = Math.floor(99 / IMPORT_COLUMNS); // D1 allows 100 bound parameters per query

const importInput = z.object({
  movements: z
    .array(
      movementInput.extend({
        balance: z.number().nonnegative(),
        trade_date: z.iso
          .date()
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .max(5000),
  cashMovements: z
    .array(movementInput.extend({ kind: z.enum(["buy", "sell"]), trade_date: z.iso.date() }))
    .max(5000)
    .default([]),
  remove: z.array(z.number().int().positive()).max(5000).default([]),
  dividends: z
    .array(z.object({ symbol: movementInput.shape.symbol, date: z.iso.date(), amount: z.number().int().positive() }))
    .max(2000)
    .default([]),
});

ledger.post("/movements/import", zValidator("json", importInput), async (c) => {
  const db = c.env.DB;
  const userId = c.var.user.id;
  const { movements, cashMovements, remove, dividends } = c.req.valid("json");
  const statements: D1PreparedStatement[] = [];

  // Only cash-only transactions may be removed this way.
  for (let i = 0; i < remove.length; i += 90) {
    const ids = remove.slice(i, i + 90);
    statements.push(
      db
        .prepare(
          `DELETE FROM stock_movements WHERE user_id = ? AND origin = 'cash' AND id IN (${ids.map(() => "?").join(", ")})`,
        )
        .bind(userId, ...ids),
    );
  }

  for (let i = 0; i < movements.length; i += ROWS_PER_INSERT) {
    const chunk = movements.slice(i, i + ROWS_PER_INSERT);
    statements.push(
      db
        .prepare(
          `INSERT INTO stock_movements (user_id, symbol, date, kind, quantity, balance, price, fee, tax, trade_date, source, origin)
           VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'statement', 'securities')").join(", ")}
           ON CONFLICT (user_id, symbol, date, kind, quantity, balance) WHERE source = 'statement' DO UPDATE SET
             price = COALESCE(excluded.price, price),
             fee = COALESCE(excluded.fee, fee),
             tax = COALESCE(excluded.tax, tax),
             trade_date = COALESCE(excluded.trade_date, trade_date)`,
        )
        .bind(
          ...chunk.flatMap((m) => [
            userId,
            m.symbol,
            m.date,
            m.kind,
            m.quantity,
            m.balance,
            m.price,
            m.fee,
            m.tax,
            m.trade_date,
          ]),
        ),
    );
  }

  const CASH_COLUMNS = 9;
  const cashRows = Math.floor(99 / CASH_COLUMNS);
  for (let i = 0; i < cashMovements.length; i += cashRows) {
    const chunk = cashMovements.slice(i, i + cashRows);
    statements.push(
      db
        .prepare(
          `INSERT INTO stock_movements (user_id, symbol, date, kind, quantity, price, fee, tax, trade_date, source, origin)
           VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, 'statement', 'cash')").join(", ")}
           ON CONFLICT (user_id, symbol, trade_date, kind) WHERE origin = 'cash' DO NOTHING`,
        )
        .bind(
          ...chunk.flatMap((m) => [userId, m.symbol, m.date, m.kind, m.quantity, m.price, m.fee, m.tax, m.trade_date]),
        ),
    );
  }

  const symbols = [...movements, ...cashMovements, ...dividends].map((m) => m.symbol);
  for (const symbol of new Set(symbols)) {
    statements.push(ensureHolding(db, userId, symbol));
  }

  // Cash dividends, skipping one already recorded for that holding with the same date and amount.
  for (const d of dividends) {
    statements.push(
      db
        .prepare(
          `INSERT INTO dividends (user_id, stock_id, type, cash_amount, paid_date)
           SELECT ?1, s.id, 'cash', ?2, ?3 FROM stocks s WHERE s.user_id = ?1 AND s.symbol = ?4
             AND NOT EXISTS (SELECT 1 FROM dividends d WHERE d.stock_id = s.id AND d.type = 'cash' AND d.paid_date = ?3 AND d.cash_amount = ?2)`,
        )
        .bind(userId, d.amount, d.date, d.symbol),
    );
  }

  if (statements.length) await db.batch(statements);

  // Saving a statement can't oversell (its balances never go negative), but report any symbol that now does,
  // e.g. after a sale entered by hand overlaps imported history.
  const all = await loadMovements(db, userId);
  const problems = [...new Set(all.map((m) => m.symbol))]
    .map((s) =>
      overSoldMessage(
        s,
        all.filter((m) => m.symbol === s),
      ),
    )
    .filter(Boolean);
  return c.json({ ok: true, warnings: problems });
});
