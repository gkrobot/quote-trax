-- Account created by the in-app setup page. Replaces the Worker secrets
-- APP_PASSWORD_HASH, TOTP_SECRET and SESSION_SECRET.
CREATE TABLE IF NOT EXISTS account (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT NOT NULL,
  session_secret TEXT NOT NULL,
  last_counter  INTEGER NOT NULL DEFAULT -1,
  created_at    TEXT NOT NULL
);

-- Holds a setup in progress until the authenticator code is confirmed.
CREATE TABLE IF NOT EXISTS setup_pending (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  username       TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  totp_secret    TEXT NOT NULL,
  session_secret TEXT NOT NULL,
  expires_at     INTEGER NOT NULL
);
