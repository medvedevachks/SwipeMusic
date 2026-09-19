-- 0002_source_track_metadata.sql
ALTER TABLE collection_items
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS artist text,
  ADD COLUMN IF NOT EXISTS page_url text,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS availability text,
  ADD COLUMN IF NOT EXISTS playback_mode text,
  ADD COLUMN IF NOT EXISTS position integer;
