-- The currency each user views amounts in. Stored amounts keep their own currency; this only affects display.
-- Allowed values are checked by the API (worker/currency.ts), so the list can grow without a table rebuild.
ALTER TABLE users ADD COLUMN currency TEXT NOT NULL DEFAULT 'VND';
