import { ensureHolding, type MovementFields } from "../holdings/queries";

// D1 access for saving an imported statement and for the import history.

export type SecuritiesRow = MovementFields & { symbol: string; balance: number; trade_date: string | null };
export type CashRow = MovementFields & { symbol: string; kind: "buy" | "sell"; trade_date: string };
export type ImportedDividend = { symbol: string; date: string; amount: number };
export type ImportedFile = {
  statement: "securities" | "cash";
  broker: string;
  file_name?: string | null;
  from?: string | null;
  to?: string | null;
  rows: number;
};
export type ImportPlan = {
  movements: SecuritiesRow[];
  cashMovements: CashRow[];
  remove: number[];
  dividends: ImportedDividend[];
  files: ImportedFile[];
  changes: number;
};

// D1 allows 100 bound parameters per query.
const rowsPerInsert = (columns: number) => Math.floor(99 / columns);
const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

// Applies an import plan in one batch, so either all of it is saved or none of it is (history included).
//
// Securities-statement rows are matched on (symbol, settlement date, type, shares, balance after); a row already
// saved keeps it and gains any price, fee, tax or trade date the import now knows (from the cash statement).
// Cash-statement trade days without a securities row are saved as their own transactions (one per symbol, side
// and trade day); `remove` lists those that a securities row now replaces.
export async function saveImport(db: D1Database, userId: number, plan: ImportPlan) {
  const { movements, cashMovements, remove, dividends, files, changes } = plan;
  const statements: D1PreparedStatement[] = [];

  // Only cash-only transactions may be removed this way.
  for (const ids of chunks(remove, 90)) {
    statements.push(
      db
        .prepare(
          `DELETE FROM stock_movements WHERE user_id = ? AND origin = 'cash' AND id IN (${ids.map(() => "?").join(", ")})`,
        )
        .bind(userId, ...ids),
    );
  }

  for (const chunk of chunks(movements, rowsPerInsert(11))) {
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

  for (const chunk of chunks(cashMovements, rowsPerInsert(9))) {
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

  // Saved in the same batch, so the history only lists imports that went through.
  for (const f of files) {
    statements.push(
      db
        .prepare(
          `INSERT INTO import_history (user_id, statement, broker, file_name, period_from, period_to, rows, changes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, f.statement, f.broker, f.file_name ?? null, f.from ?? null, f.to ?? null, f.rows, changes),
    );
  }

  if (statements.length) await db.batch(statements);
}

// Statement files imported so far, newest first.
export const listImports = async (db: D1Database, userId: number) =>
  (
    await db
      .prepare(
        `SELECT id, statement, broker, file_name, period_from, period_to, rows, changes, imported_at
     FROM import_history WHERE user_id = ? ORDER BY imported_at DESC, id DESC LIMIT 500`,
      )
      .bind(userId)
      .all()
  ).results;
