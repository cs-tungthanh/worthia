-- Accounts. A user signs in with Google (google_sub set), a password (password_hash set), or both.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT,
  google_sub    TEXT    UNIQUE,
  password_hash TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Sign-in sessions. Only the SHA-256 of the cookie token is stored, so a leaked DB can't be used to sign in.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sessions_user_id ON sessions (user_id);

-- Stock holdings: one row per symbol.
-- avg_price is the average buy price per share in VND; REAL because averaging several buys rarely lands on a whole number.
CREATE TABLE stocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT    NOT NULL,
  shares     REAL    NOT NULL CHECK (shares >= 0),
  avg_price  REAL    CHECK (avg_price IS NULL OR avg_price >= 0),
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX stocks_user_id ON stocks (user_id);

-- Savings deposits: amount is stored in whole units of the currency (e.g. VND has no decimals).
-- The maturity date is derived from start_date + term_months; term_months NULL means a demand deposit
-- (không kỳ hạn) with no maturity.
CREATE TABLE savings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank          TEXT    NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  currency      TEXT    NOT NULL DEFAULT 'VND',
  interest_rate REAL,
  start_date    TEXT,
  term_months   INTEGER CHECK (term_months IS NULL OR term_months > 0),
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX savings_user_id ON savings (user_id);

-- Dividends received on a holding. Cash: cash_amount is the VND actually received (after tax).
-- Stock: shares is the number of bonus shares received; the app adds them to the holding.
CREATE TABLE dividends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_id    INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK (type IN ('cash', 'stock')),
  cash_amount INTEGER CHECK (cash_amount IS NULL OR cash_amount >= 0),
  shares      REAL    CHECK (shares IS NULL OR shares >= 0),
  paid_date   TEXT    NOT NULL,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK ((type = 'cash' AND cash_amount IS NOT NULL AND shares IS NULL)
      OR (type = 'stock' AND shares IS NOT NULL AND cash_amount IS NULL))
);
CREATE INDEX dividends_user_id ON dividends (user_id);
CREATE INDEX dividends_stock_id ON dividends (stock_id);

-- Banks pinned for quick picking in the savings form, per user.
CREATE TABLE favourite_banks (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);
