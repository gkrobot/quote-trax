CREATE TABLE series (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE books (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  author          TEXT NOT NULL,
  series_id       TEXT REFERENCES series(id) ON DELETE SET NULL,
  series_position INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE quotes (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  page        TEXT,
  attribution TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_books_series ON books(series_id);
CREATE INDEX idx_quotes_book  ON quotes(book_id);
