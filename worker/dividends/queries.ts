// D1 access for cash dividends. Bonus shares are share movements instead (see holdings/).

export type DividendInput = {
  stock_id: number;
  type: "cash";
  cash_amount: number;
  shares: null;
  paid_date: string;
};

export const listDividends = async (db: D1Database, userId: number) =>
  (await db.prepare("SELECT * FROM dividends WHERE user_id = ? ORDER BY paid_date DESC, id DESC").bind(userId).all())
    .results;

// What each holding received, for its net average cost.
export const listCashDividends = async (db: D1Database, userId: number) =>
  (
    await db
      .prepare(
        "SELECT stock_id, paid_date AS date, cash_amount AS amount FROM dividends WHERE user_id = ? AND type = 'cash'",
      )
      .bind(userId)
      .all<{ stock_id: number; date: string; amount: number }>()
  ).results;

export const insertDividend = (db: D1Database, userId: number, d: DividendInput) =>
  db
    .prepare(
      `INSERT INTO dividends (stock_id, type, cash_amount, shares, paid_date, user_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(d.stock_id, d.type, d.cash_amount, d.shares, d.paid_date, userId)
    .first();

export const updateDividend = (db: D1Database, userId: number, id: number, d: DividendInput) =>
  db
    .prepare(
      `UPDATE dividends SET stock_id = ?, type = ?, cash_amount = ?, shares = ?, paid_date = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? RETURNING *`,
    )
    .bind(d.stock_id, d.type, d.cash_amount, d.shares, d.paid_date, id, userId)
    .first();

export const deleteDividend = async (db: D1Database, userId: number, id: number) =>
  (await db.prepare("DELETE FROM dividends WHERE id = ? AND user_id = ?").bind(id, userId).run()).meta.changes > 0;
