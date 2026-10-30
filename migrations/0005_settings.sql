-- Phase 12: a person's settings, saved to their account so they follow them to any
-- device — the default text box and text size, and any shortcuts they changed.
--
-- One JSON document per person, read and written whole; the browser and the Worker
-- both pass it through sanitiseSettings (shared/settings.ts).

CREATE TABLE IF NOT EXISTS user_settings (
  uid         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings    TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
