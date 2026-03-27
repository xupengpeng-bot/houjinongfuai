-- COD-2026-03-27-035 follow-up: published network graph as solver input truth (additive).

ALTER TABLE network_model_version
  ADD COLUMN IF NOT EXISTS published_at timestamptz NULL;

COMMENT ON COLUMN network_model_version.published_at IS
  'When this version was marked published; NULL when draft or after unpublish.';

COMMENT ON COLUMN network_model_version.is_published IS
  'At most one row per network_model_id may be true (enforced by partial unique index).';

-- One published version per hydraulic model header.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_model_version_one_published_per_model
  ON network_model_version (network_model_id)
  WHERE is_published = true;

-- Demo graph from seed 004: mark version 1 published so solver e2e can bind to a real published row.
UPDATE network_model_version
SET is_published = true,
    published_at = COALESCE(published_at, created_at)
WHERE id = '00000000-0000-0000-0000-000000000a11'
  AND network_model_id = '00000000-0000-0000-0000-000000000a10';
