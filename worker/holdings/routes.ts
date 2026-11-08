import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { listCashDividends } from "../dividends/queries";
import { type AppEnv, idParam } from "../http";
import { overSoldMessage, summariseHolding } from "./positions";
import {
  deleteMovement,
  deleteStockWithHistory,
  findMovement,
  findStock,
  insertManualMovement,
  listMovements,
  listStocks,
  type MovementRow,
  updateMovement,
} from "./queries";

// Holdings and the share movements (buys, sells, bonus issues) they are computed from: see shared/position.ts.

export const holdings = new Hono<AppEnv>();

// ---------- holdings ----------

holdings.get("/stocks", async (c) => {
  const db = c.env.DB;
  const userId = c.var.user.id;
  const [stocks, movements, dividends] = await Promise.all([
    listStocks(db, userId),
    listMovements(db, userId),
    listCashDividends(db, userId),
  ]);
  return c.json(
    stocks.map((s) =>
      summariseHolding(
        s,
        movements.filter((m) => m.symbol === s.symbol),
        dividends.filter((d) => d.stock_id === s.id),
      ),
    ),
  );
});

// Deletes a holding with its whole history and dividends.
holdings.delete("/stocks/:id", idParam, async (c) => {
  const { id } = c.req.valid("param");
  const stock = await findStock(c.env.DB, c.var.user.id, id);
  if (!stock) return c.json({ error: "Not found" }, 404);
  await deleteStockWithHistory(c.env.DB, c.var.user.id, id, stock.symbol);
  return c.body(null, 204);
});

// ---------- movements ----------

const money = z
  .number()
  .nonnegative()
  .nullish()
  .transform((v) => v ?? null);
// Also the base of each imported row (see imports/routes.ts).
export const movementInput = z.object({
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

holdings.get("/movements", zValidator("query", z.object({ symbol: z.string().trim().max(20).optional() })), async (c) =>
  c.json(await listMovements(c.env.DB, c.var.user.id, c.req.valid("query").symbol?.toUpperCase())),
);

// One transaction entered in the app.
holdings.post("/movements", zValidator("json", movementInput), async (c) => {
  const db = c.env.DB;
  const m = c.req.valid("json");
  const existing = await listMovements(db, c.var.user.id, m.symbol);
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
  return c.json(await insertManualMovement(db, c.var.user.id, m), 201);
});

// Edits a movement. Statement rows keep their date, type and shares (re-importing relies on them); only the
// price, fee and tax can change.
holdings.put("/movements/:id", idParam, zValidator("json", movementInput.omit({ symbol: true })), async (c) => {
  const db = c.env.DB;
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const current = await findMovement(db, c.var.user.id, id);
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
  const rows = (await listMovements(db, c.var.user.id, current.symbol)).map((r) =>
    r.id === id ? { ...r, ...body } : r,
  );
  const problem = overSoldMessage(current.symbol, rows);
  if (problem) return c.json({ error: problem }, 400);
  return c.json(await updateMovement(db, c.var.user.id, id, body));
});

holdings.delete("/movements/:id", idParam, async (c) => {
  const db = c.env.DB;
  const { id } = c.req.valid("param");
  const current = await findMovement(db, c.var.user.id, id);
  if (!current) return c.json({ error: "Not found" }, 404);
  const rows = (await listMovements(db, c.var.user.id, current.symbol)).filter((r) => r.id !== id);
  const problem = overSoldMessage(current.symbol, rows);
  if (problem) return c.json({ error: `Can't delete: ${problem}` }, 400);
  await deleteMovement(db, c.var.user.id, id);
  return c.body(null, 204);
});
