-- 017_well_block_id_cockpit.sql
-- COD-2026-03-26-027: optional block grain on well for cockpit aggregation (additive).

ALTER TABLE well
  ADD COLUMN IF NOT EXISTS block_id uuid NULL REFERENCES project_block (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_well_block_id ON well (tenant_id, block_id);

COMMENT ON COLUMN well.block_id IS 'Optional irrigation / ops block; used when attributing wells to a project_block for cockpit metrics.';
