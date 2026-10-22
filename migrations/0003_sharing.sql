-- Phase 8: sharing, comments, notifications and an audit trail.
--
-- A board or folder can be shared two ways, both rows of `shares`:
--   person  one Google account, by email, with a role
--   link    a secret token in a URL, with a role and an audience — anyone who has it,
--           anyone signed in, or anyone signed in at one email domain
-- A resource has at most one live link. Revoking it (or resetting it) retires the
-- token for good; turning sharing back on mints a new one.
--
-- What someone may do with a board is worked out in worker/access.ts from these
-- rows, the folder chain above the board, and who owns it. Nothing here is cached
-- elsewhere, so a change takes effect on the next request — and open rooms are told.

CREATE TABLE IF NOT EXISTS shares (
  id            TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('board', 'folder')),
  resource_id   TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('person', 'link')),
  email         TEXT,                     -- person: lowercased
  token         TEXT UNIQUE,              -- link: the secret in the URL
  role          TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
  audience      TEXT CHECK (audience IN ('anyone', 'signed-in', 'domain')),
  domain        TEXT,                     -- audience = 'domain': lowercased, no @
  expires_at    INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_shares_resource ON shares(resource_type, resource_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_shares_email ON shares(email, revoked_at);

-- Whether people who can only view or comment may export and copy. On by default.
ALTER TABLE boards ADD COLUMN viewer_export INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  thread_id   TEXT NOT NULL,              -- the first comment's own id
  author_uid  TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  x           REAL,                       -- where the thread is pinned on the board
  y           REAL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER                     -- set on the thread's first comment
);

CREATE INDEX IF NOT EXISTS idx_comments_board ON comments(board_id, thread_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,               -- lowercased; works before they first sign in
  kind       TEXT NOT NULL,               -- 'shared' | 'mention'
  board_id   TEXT,
  folder_id  TEXT,
  actor_name TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(email, read_at, created_at);

CREATE TABLE IF NOT EXISTS audit (
  id            TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  actor_uid     TEXT NOT NULL,
  actor_email   TEXT NOT NULL,
  action        TEXT NOT NULL,
  detail        TEXT NOT NULL,            -- human-readable
  at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit(resource_type, resource_id, at);
