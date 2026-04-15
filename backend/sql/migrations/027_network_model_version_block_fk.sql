-- COD-2026-04-06-001: make network_model_version formally belong to project_block
-- instead of relying on source_meta_json.block_id as the scope key.

ALTER TABLE network_model_version
  ADD COLUMN IF NOT EXISTS block_id uuid NULL;

COMMENT ON COLUMN network_model_version.block_id IS
  'Formal block ownership for this versioned network graph. Replaces source_meta_json.block_id as relational truth.';

UPDATE network_model_version nmv
SET block_id = pb.id
FROM project_block pb
WHERE nmv.block_id IS NULL
  AND pb.id = nullif(nmv.source_meta_json->>'block_id', '')::uuid;

DELETE FROM network_model_version
WHERE block_id IS NULL
  AND is_published = false
  AND nullif(source_meta_json->>'block_id', '') IS NOT NULL;

WITH ranked_published AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY network_model_id, block_id
      ORDER BY coalesce(published_at, created_at) DESC, version_no DESC, id DESC
    ) AS rn
  FROM network_model_version
  WHERE is_published = true
    AND block_id IS NOT NULL
)
UPDATE network_model_version nmv
SET is_published = false,
    published_at = coalesce(nmv.published_at, nmv.created_at)
FROM ranked_published ranked
WHERE nmv.id = ranked.id
  AND ranked.rn > 1;

WITH ranked_drafts AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY network_model_id, block_id
      ORDER BY created_at DESC, version_no DESC, id DESC
    ) AS rn
  FROM network_model_version
  WHERE is_published = false
    AND published_at IS NULL
    AND block_id IS NOT NULL
)
DELETE FROM network_model_version nmv
USING ranked_drafts ranked
WHERE nmv.id = ranked.id
  AND ranked.rn > 1;

WITH ranked_unscoped_published AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY network_model_id
      ORDER BY coalesce(published_at, created_at) DESC, version_no DESC, id DESC
    ) AS rn
  FROM network_model_version
  WHERE is_published = true
    AND block_id IS NULL
)
UPDATE network_model_version nmv
SET is_published = false,
    published_at = coalesce(nmv.published_at, nmv.created_at)
FROM ranked_unscoped_published ranked
WHERE nmv.id = ranked.id
  AND ranked.rn > 1;

WITH ranked_unscoped_drafts AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY network_model_id
      ORDER BY created_at DESC, version_no DESC, id DESC
    ) AS rn
  FROM network_model_version
  WHERE is_published = false
    AND published_at IS NULL
    AND block_id IS NULL
)
DELETE FROM network_model_version nmv
USING ranked_unscoped_drafts ranked
WHERE nmv.id = ranked.id
  AND ranked.rn > 1;

ALTER TABLE network_model_version
  DROP CONSTRAINT IF EXISTS fk_network_model_version_block;

ALTER TABLE network_model_version
  ADD CONSTRAINT fk_network_model_version_block
  FOREIGN KEY (block_id) REFERENCES project_block (id) ON DELETE CASCADE;

DROP INDEX IF EXISTS uq_network_model_version_one_published_per_model;

CREATE INDEX IF NOT EXISTS idx_network_model_version_block
  ON network_model_version (block_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_network_model_version_model_block
  ON network_model_version (network_model_id, block_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_network_model_version_one_published_per_model_block
  ON network_model_version (network_model_id, block_id)
  WHERE is_published = true
    AND block_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_network_model_version_one_draft_per_model_block
  ON network_model_version (network_model_id, block_id)
  WHERE is_published = false
    AND published_at IS NULL
    AND block_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_network_model_version_one_published_per_model_unscoped
  ON network_model_version (network_model_id)
  WHERE is_published = true
    AND block_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_network_model_version_one_draft_per_model_unscoped
  ON network_model_version (network_model_id)
  WHERE is_published = false
    AND published_at IS NULL
    AND block_id IS NULL;
