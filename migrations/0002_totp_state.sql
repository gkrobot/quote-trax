-- Stores the last accepted TOTP time-step so a code can only be used once.
CREATE TABLE totp_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_counter INTEGER NOT NULL
);

INSERT INTO totp_state (id, last_counter) VALUES (1, -1);
