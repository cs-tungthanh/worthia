-- Where an imported transaction came from:
--   'securities' - a row of the securities statement (settlement date, balance after it; priced by the cash statement)
--   'cash'       - a trade from the cash statement imported without a matching securities row: one row per
--                  symbol, side and trade day (partial fills summed), dated at the trade date, no balance.
--                  Replaced by the securities rows when that statement is imported (see src/import/plan.ts).
-- NULL for transactions entered in the app.
ALTER TABLE stock_movements ADD COLUMN origin TEXT CHECK (origin IS NULL OR origin IN ('securities', 'cash'));
UPDATE stock_movements SET origin = 'securities' WHERE source = 'statement';

-- Re-importing a cash statement must not duplicate its trades.
CREATE UNIQUE INDEX stock_movements_cash_trade
  ON stock_movements (user_id, symbol, trade_date, kind)
  WHERE origin = 'cash';
