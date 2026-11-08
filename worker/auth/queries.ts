import type { Currency } from "../../shared/config";

// D1 access for users, sessions and password resets. Tokens arrive here already hashed.

export type User = { id: number; email: string; name: string | null; currency: Currency };

const USER_COLUMNS = "id, email, name, currency";

// ---------- sessions ----------

// Also clears out expired sessions, so the table doesn't grow forever.
export const createSession = (db: D1Database, tokenHash: string, userId: number, days: number) =>
  db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    db
      .prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${days} days'))`)
      .bind(tokenHash, userId),
  ]);

export const findSessionUser = (db: D1Database, tokenHash: string) =>
  db
    .prepare(
      `SELECT u.id, u.email, u.name, u.currency FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .first<User>();

export const deleteSession = (db: D1Database, tokenHash: string) =>
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();

// ---------- users ----------

// Null if the email is already taken.
export const createPasswordUser = (db: D1Database, email: string, name: string | null, passwordHash: string) =>
  db
    .prepare(
      `INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING RETURNING ${USER_COLUMNS}`,
    )
    .bind(email, name, passwordHash)
    .first<User>();

export const findUserForLogin = (db: D1Database, email: string) =>
  db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .bind(email)
    .first<User & { password_hash: string | null }>();

export const setCurrency = (db: D1Database, userId: number, currency: Currency) =>
  db
    .prepare(`UPDATE users SET currency = ? WHERE id = ? RETURNING ${USER_COLUMNS}`)
    .bind(currency, userId)
    .first<User>();

// ---------- password resets (password accounts only) ----------

export const findPasswordUser = (db: D1Database, email: string) =>
  db
    .prepare("SELECT id, email, name FROM users WHERE email = ? AND password_hash IS NOT NULL")
    .bind(email)
    .first<{ id: number; email: string; name: string | null }>();

export const resetRequestedWithin = async (db: D1Database, userId: number, minutes: number) =>
  Boolean(
    await db
      .prepare(`SELECT 1 FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-${minutes} minute')`)
      .bind(userId)
      .first(),
  );

// One live reset link per user: any earlier one (and any expired one) is dropped.
export const replaceResetToken = (db: D1Database, userId: number, tokenHash: string, minutes: number) =>
  db.batch([
    db.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at <= datetime('now')").bind(userId),
    db
      .prepare(
        `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${minutes} minutes'))`,
      )
      .bind(tokenHash, userId),
  ]);

// The account must still have a password: one that was linked to Google since the email went out has none.
export const findResetUser = (db: D1Database, tokenHash: string) =>
  db
    .prepare(
      `SELECT u.id, u.email, u.name, u.currency FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ? AND r.expires_at > datetime('now') AND u.password_hash IS NOT NULL`,
    )
    .bind(tokenHash)
    .first<User>();

// New password, every reset link used up, and every existing session signed out.
export const setPassword = (db: D1Database, userId: number, passwordHash: string) =>
  db.batch([
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, userId),
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
  ]);

// ---------- Google accounts ----------

export const findUserIdByGoogleSub = (db: D1Database, sub: string) =>
  db.prepare("SELECT id FROM users WHERE google_sub = ?").bind(sub).first<{ id: number }>();

export const findUserIdByEmail = (db: D1Database, email: string) =>
  db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();

// Google proves this person owns the email; a password set at registration never did (emails aren't
// verified). Dropping it stops anyone who registered this email first from keeping access.
export const linkGoogleAccount = (db: D1Database, userId: number, sub: string, name: string | null) =>
  db
    .prepare("UPDATE users SET google_sub = ?, password_hash = NULL, name = COALESCE(name, ?) WHERE id = ?")
    .bind(sub, name, userId)
    .run();

export const createGoogleUser = (db: D1Database, email: string, name: string | null, sub: string) =>
  db
    .prepare("INSERT INTO users (email, name, google_sub) VALUES (?, ?, ?) RETURNING id")
    .bind(email, name, sub)
    .first<{ id: number }>();
