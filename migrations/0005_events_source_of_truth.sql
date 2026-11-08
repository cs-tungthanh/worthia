-- Share movements become the source of truth: a holding's shares, average cost and realised profit are computed
-- from its movements (shared/position.ts). `stocks` keeps one row per user and symbol as the holding's identity
-- (dividends point at it); its `shares` / `avg_price` columns are no longer read after this migration.
-- Every holding's total is preserved: stock dividends become bonus movements, and any shares not explained by the
-- history get one opening movement.

-- Trade details from the cash statement (or typed in): fee and tax in VND, and the trade date (T0) when the
-- movement's own date is the settlement date.
ALTER TABLE stock_movements ADD COLUMN fee REAL CHECK (fee IS NULL OR fee >= 0);
ALTER TABLE stock_movements ADD COLUMN tax REAL CHECK (tax IS NULL OR tax >= 0);
ALTER TABLE stock_movements ADD COLUMN trade_date TEXT;

-- 1. One holding per user and symbol: merge duplicates into the oldest row (shares summed, price share-weighted).
UPDATE stocks SET
  avg_price = (SELECT CASE WHEN COUNT(*) = COUNT(avg_price) AND SUM(shares) > 0
                           THEN SUM(avg_price * shares) / SUM(shares) END
               FROM stocks d WHERE d.user_id = stocks.user_id AND d.symbol = stocks.symbol),
  shares = (SELECT SUM(shares) FROM stocks d WHERE d.user_id = stocks.user_id AND d.symbol = stocks.symbol)
WHERE id = (SELECT MIN(id) FROM stocks d WHERE d.user_id = stocks.user_id AND d.symbol = stocks.symbol)
  AND (SELECT COUNT(*) FROM stocks d WHERE d.user_id = stocks.user_id AND d.symbol = stocks.symbol) > 1;
UPDATE dividends SET stock_id = (
  SELECT MIN(k.id) FROM stocks k JOIN stocks o ON o.id = dividends.stock_id
  WHERE k.user_id = o.user_id AND k.symbol = o.symbol
);
DELETE FROM stocks WHERE id <> (SELECT MIN(id) FROM stocks d WHERE d.user_id = stocks.user_id AND d.symbol = stocks.symbol);
CREATE UNIQUE INDEX stocks_user_symbol ON stocks (user_id, symbol);

-- 2. Stock dividends become bonus movements (unless an imported bonus already records the same issue).
INSERT INTO stock_movements (user_id, symbol, date, kind, quantity, source)
SELECT s.user_id, s.symbol, d.paid_date, 'bonus', d.shares, 'manual'
FROM dividends d JOIN stocks s ON s.id = d.stock_id
WHERE d.type = 'stock' AND d.shares > 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements m
    WHERE m.user_id = s.user_id AND m.symbol = s.symbol AND m.kind = 'bonus' AND m.date = d.paid_date AND m.quantity = d.shares
  );

-- 3. Opening movements for whatever the history doesn't explain, dated when the holding was created (or last
--    edited). A holding showed shares bought + its stock-dividend shares; an opening buy is priced at the price
--    per share bought (avg_price), since the bonus movements above already carry the free shares.
CREATE TABLE holding_gap AS -- scratch table (D1 has no TEMP tables), dropped below
SELECT s.user_id, s.symbol, s.avg_price, s.created_at, s.updated_at,
       s.shares + COALESCE((SELECT SUM(d.shares) FROM dividends d WHERE d.stock_id = s.id AND d.type = 'stock'), 0)
         - COALESCE((SELECT SUM(CASE m.kind WHEN 'sell' THEN -m.quantity ELSE m.quantity END)
                     FROM stock_movements m WHERE m.user_id = s.user_id AND m.symbol = s.symbol), 0) AS gap
FROM stocks s;

INSERT INTO stock_movements (user_id, symbol, date, kind, quantity, price, source)
SELECT user_id, symbol, date(created_at), 'buy', gap, avg_price, 'manual' FROM holding_gap WHERE gap > 0.000001;

INSERT INTO stock_movements (user_id, symbol, date, kind, quantity, source)
SELECT user_id, symbol, date(updated_at), 'sell', -gap, 'manual' FROM holding_gap WHERE gap < -0.000001;

DROP TABLE holding_gap;

-- 4. Stock dividends are now bonus movements.
DELETE FROM dividends WHERE type = 'stock';

-- 5. Every symbol with history gets a holding row, so sold-out stocks can be listed (and carry dividends).
INSERT INTO stocks (user_id, symbol, shares)
SELECT DISTINCT m.user_id, m.symbol, 0 FROM stock_movements m
WHERE NOT EXISTS (SELECT 1 FROM stocks s WHERE s.user_id = m.user_id AND s.symbol = m.symbol);
