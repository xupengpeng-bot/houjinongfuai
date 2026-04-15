-- COD-2026-04-06-001
-- Project administrative region is now derived from project.region_id -> region.region_code.
-- Remove the redundant persisted project.manual_region_id column.

DROP INDEX IF EXISTS idx_project_manual_region_id;

ALTER TABLE project
DROP COLUMN IF EXISTS manual_region_id;
