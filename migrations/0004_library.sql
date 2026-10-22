-- Phase 9: a personal library of saved groups, to drop onto any board.
--
-- An item is the elements as JSON, exactly as copied — positions relative to the
-- group's top-left corner. Images inside an item are referenced by hash, and
-- `library_files` keeps those images from being swept while the item exists.

CREATE TABLE IF NOT EXISTS library_items (
  id          TEXT PRIMARY KEY,
  owner_uid   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  elements    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_owner ON library_items(owner_uid, created_at);

CREATE TABLE IF NOT EXISTS library_files (
  item_id  TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  hash     TEXT NOT NULL,
  PRIMARY KEY (item_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_library_files_hash ON library_files(hash);
