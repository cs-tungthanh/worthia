-- One row per statement file each time an import is saved: which statement it was and the period it covers
-- (from its title, "Từ ngày … Đến ngày …"), so the user can see which time ranges have been imported.
CREATE TABLE import_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement   TEXT    NOT NULL CHECK (statement IN ('securities', 'cash')),
  broker      TEXT    NOT NULL,
  file_name   TEXT,
  period_from TEXT,                -- YYYY-MM-DD; NULL if the file didn't state it
  period_to   TEXT,
  rows        INTEGER NOT NULL,    -- share movements (securities) or trades + cash dividends (cash) in the file
  changes     INTEGER NOT NULL,    -- changes saved by the import this file was part of
  imported_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX import_history_user_id ON import_history (user_id, imported_at);
