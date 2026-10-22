-- Images live in R2 once each, keyed by the SHA-256 of their bytes, so pasting the
-- same screenshot twice — or into two boards — stores one object.
--
-- `board_files` says which boards use which image. It is rewritten from the board's
-- own document on every save, so it follows deletes and undos without the browser
-- having to report them. An image no board refers to is removed when the trash is
-- emptied, not the moment it leaves a board, so undo can still bring it back.

CREATE TABLE IF NOT EXISTS files (
  hash         TEXT PRIMARY KEY,        -- lowercase hex SHA-256 of the stored bytes
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS board_files (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  -- Deliberately not a foreign key: a board can refer to an image whose upload is
  -- still on its way, and that reference has to survive until it lands.
  hash     TEXT NOT NULL,
  PRIMARY KEY (board_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_board_files_hash ON board_files(hash);
