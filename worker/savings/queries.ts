// D1 access for savings deposits and favourite banks.

export type SavingInput = {
  bank: string;
  amount: number;
  currency: string;
  interest_rate: number | null;
  start_date: string | null;
  term_months: number | null;
};

const values = (s: SavingInput) => [s.bank, s.amount, s.currency, s.interest_rate, s.start_date, s.term_months];

// ---------- deposits ----------

export const listSavings = async (db: D1Database, userId: number) =>
  (await db.prepare("SELECT * FROM savings WHERE user_id = ? ORDER BY bank, start_date").bind(userId).all()).results;

export const insertSaving = (db: D1Database, userId: number, s: SavingInput) =>
  db
    .prepare(
      `INSERT INTO savings (bank, amount, currency, interest_rate, start_date, term_months, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(...values(s), userId)
    .first();

export const updateSaving = (db: D1Database, userId: number, id: number, s: SavingInput) =>
  db
    .prepare(
      `UPDATE savings SET bank = ?, amount = ?, currency = ?, interest_rate = ?, start_date = ?, term_months = ?,
         updated_at = datetime('now')
       WHERE id = ? AND user_id = ? RETURNING *`,
    )
    .bind(...values(s), id, userId)
    .first();

export const deleteSaving = async (db: D1Database, userId: number, id: number) =>
  (await db.prepare("DELETE FROM savings WHERE id = ? AND user_id = ?").bind(id, userId).run()).meta.changes > 0;

// ---------- favourite banks ----------

export const listFavouriteBanks = async (db: D1Database, userId: number) =>
  (
    await db
      .prepare("SELECT name FROM favourite_banks WHERE user_id = ? ORDER BY created_at, name")
      .bind(userId)
      .all<{ name: string }>()
  ).results.map((r) => r.name);

export const addFavouriteBank = (db: D1Database, userId: number, name: string) =>
  db.prepare("INSERT OR IGNORE INTO favourite_banks (user_id, name) VALUES (?, ?)").bind(userId, name).run();

export const removeFavouriteBank = (db: D1Database, userId: number, name: string) =>
  db.prepare("DELETE FROM favourite_banks WHERE user_id = ? AND name = ?").bind(userId, name).run();
