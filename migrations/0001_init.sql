-- Folders and boards. Board *content* lives in R2 as a Yjs snapshot; this holds
-- only what has to be queried: who owns what, what it is called, where it sits.
--
-- Sharing and permissions arrive in Phase 8, which is why `owner_id` is the only
-- access check here. The columns it will add hang off these two tables.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- Firebase uid
  email       TEXT NOT NULL,
  name        TEXT,
  picture     TEXT,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  starred     INTEGER NOT NULL DEFAULT 0,
  -- Lowercased text pulled out of the board, so titles and content are searchable
  -- without reading every snapshot back out of R2.
  search_text TEXT NOT NULL DEFAULT '',
  thumbnail_key TEXT,
  snapshot_key  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  opened_at   INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id, parent_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_boards_owner ON boards(owner_id, folder_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_boards_recent ON boards(owner_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_boards_starred ON boards(owner_id, starred, deleted_at);
