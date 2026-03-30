-- COD-2026-03-28-014 follow-up: persist user-saved DWG/map source registration
-- and import metadata alongside the versioned network graph.

ALTER TABLE network_model_version
  ADD COLUMN IF NOT EXISTS source_meta_json jsonb NULL;

COMMENT ON COLUMN network_model_version.source_meta_json IS
  'User-saved map/DWG source registration, import notes, provider hints, and relation generation strategy for this version.';
