-- One-time password reset links. Only the SHA-256 of the emailed token is stored.
CREATE TABLE password_resets (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX password_resets_user_id ON password_resets (user_id);
