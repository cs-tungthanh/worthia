-- Dated share movements per stock, for the lifecycle view. Kept by symbol (not by holding) so the history
-- survives a holding being deleted and re-added.
--   kind:     buy (shares received from a buy), sell (shares delivered for a sale), bonus (bonus issue)
--   quantity: shares moved, always positive; the kind gives the direction
--   balance:  shares held right after, when the source states it (statements do; manual buys don't)
--   price:    VND per share, when known (manual buys with an avg price; statements have none)
CREATE TABLE stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('buy', 'sell', 'bonus')),
  quantity   REAL    NOT NULL CHECK (quantity > 0),
  balance    REAL    CHECK (balance IS NULL OR balance >= 0),
  price      REAL    CHECK (price IS NULL OR price >= 0),
  source     TEXT    NOT NULL CHECK (source IN ('statement', 'manual')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX stock_movements_user_symbol ON stock_movements (user_id, symbol, date);

-- Re-importing a statement must not duplicate rows. Two same-day buys of the same size differ by balance.
CREATE UNIQUE INDEX stock_movements_statement_row
  ON stock_movements (user_id, symbol, date, kind, quantity, balance)
  WHERE source = 'statement';
