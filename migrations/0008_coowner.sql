-- 26 November: the Co-owner role — someone who runs a board or folder as its owner
-- does (presenting, sharing, locks for others), given to named people only.
--
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt with the
-- new role allowed, every row copied across as it is (as 0006 did for Answer).

CREATE TABLE shares_next (
  id            TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('board', 'folder')),
  resource_id   TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('person', 'link')),
  email         TEXT,
  token         TEXT UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'answer', 'editor', 'coowner')),
  audience      TEXT CHECK (audience IN ('anyone', 'signed-in', 'domain')),
  domain        TEXT,
  expires_at    INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

INSERT INTO shares_next (id, resource_type, resource_id, kind, email, token, role, audience,
                         domain, expires_at, created_by, created_at, revoked_at)
  SELECT id, resource_type, resource_id, kind, email, token, role, audience,
         domain, expires_at, created_by, created_at, revoked_at
  FROM shares;

DROP TABLE shares;
ALTER TABLE shares_next RENAME TO shares;

CREATE INDEX IF NOT EXISTS idx_shares_resource ON shares(resource_type, resource_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_shares_email ON shares(email, revoked_at);
