-- Phase 16: organising the dashboard.
--
-- Folders keep the order they are dragged into (position, among their siblings; null
-- until a folder is first dragged, and then sorted by name) and can be pinned to the
-- top. Folders and boards can be archived: kept, out of the way, and brought back.
-- Archiving a folder archives what is in it at the same moment, so it all comes back
-- together, as the trash does with deleted_at.

ALTER TABLE folders ADD COLUMN position INTEGER;
ALTER TABLE folders ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN archived_at INTEGER;
ALTER TABLE boards ADD COLUMN archived_at INTEGER;
