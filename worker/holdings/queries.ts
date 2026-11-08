// D1 access for holdings (`stocks`) and their share movements (`stock_movements`).

export type MovementRow = {
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

// What a person can enter or change on a transaction.
export type MovementFields = Pick<MovementRow, "date" | "kind" | "quantity" | "price" | "fee" | "tax">;

const COLUMNS = "id, symbol, date, kind, quantity, balance, price, fee, tax, trade_date, source, origin";

// ---------- holdings ----------

export const listStocks = async (db: D1Database, userId: number) =>
  (
    await db
      .prepare("SELECT id, symbol FROM stocks WHERE user_id = ? ORDER BY symbol")
      .bind(userId)
      .all<{ id: number; symbol: string }>()
  ).results;

export const findStock = (db: D1Database, userId: number, id: number) =>
  db.prepare("SELECT symbol FROM stocks WHERE id = ? AND user_id = ?").bind(id, userId).first<{ symbol: string }>();

export const ownsStock = async (db: D1Database, userId: number, id: number) =>
  Boolean(await db.prepare("SELECT 1 FROM stocks WHERE id = ? AND user_id = ?").bind(id, userId).first());

// Its dividends go with it (foreign key cascade).
export const deleteStockWithHistory = (db: D1Database, userId: number, id: number, symbol: string) =>
  db.batch([
    db.prepare("DELETE FROM stock_movements WHERE user_id = ? AND symbol = ?").bind(userId, symbol),
    db.prepare("DELETE FROM stocks WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);

// `stocks` gives each user+symbol a stable id for dividends to point at; made on its first movement.
export const ensureHolding = (db: D1Database, userId: number, symbol: string) =>
  db.prepare("INSERT OR IGNORE INTO stocks (user_id, symbol, shares) VALUES (?, ?, 0)").bind(userId, symbol);

// ---------- movements ----------

// Sorted by symbol, then date and id: the order position math needs.
export async function listMovements(db: D1Database, userId: number, symbol?: string) {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM stock_movements WHERE user_id = ?1 AND (?2 IS NULL OR symbol = ?2) ORDER BY symbol, date, id`,
    )
    .bind(userId, symbol ?? null)
    .all<MovementRow>();
  return results;
}

export const findMovement = (db: D1Database, userId: number, id: number) =>
  db
    .prepare(`SELECT ${COLUMNS} FROM stock_movements WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<MovementRow>();

export async function insertManualMovement(
  db: D1Database,
  userId: number,
  m: MovementFields & { symbol: string },
): Promise<MovementRow> {
  const [row] = await db.batch<MovementRow>([
    db
      .prepare(
        `INSERT INTO stock_movements (user_id, symbol, date, kind, quantity, price, fee, tax, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual') RETURNING ${COLUMNS}`,
      )
      .bind(userId, m.symbol, m.date, m.kind, m.quantity, m.price, m.fee, m.tax),
    ensureHolding(db, userId, m.symbol),
  ]);
  return row.results[0];
}

export const updateMovement = (db: D1Database, userId: number, id: number, m: MovementFields) =>
  db
    .prepare(
      `UPDATE stock_movements SET date = ?, kind = ?, quantity = ?, price = ?, fee = ?, tax = ?
       WHERE id = ? AND user_id = ? RETURNING ${COLUMNS}`,
    )
    .bind(m.date, m.kind, m.quantity, m.price, m.fee, m.tax, id, userId)
    .first<MovementRow>();

export const deleteMovement = (db: D1Database, userId: number, id: number) =>
  db.prepare("DELETE FROM stock_movements WHERE id = ? AND user_id = ?").bind(id, userId).run();
