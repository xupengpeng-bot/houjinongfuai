-- 016_metering_point_display_fields.sql
-- COD-2026-03-26-015: display fields for metering_point aligned with frontend / task contract.

ALTER TABLE metering_point
  ADD COLUMN IF NOT EXISTS point_name varchar(128) NOT NULL DEFAULT '';

ALTER TABLE metering_point
  ADD COLUMN IF NOT EXISTS rated_capacity_kva numeric(12, 2) NULL;

COMMENT ON COLUMN metering_point.point_name IS 'Human-readable metering point name; distinct from metering_point_code.';
COMMENT ON COLUMN metering_point.rated_capacity_kva IS 'Optional rated capacity for UI; business unit agreed with frontend (e.g. kVA).';

UPDATE metering_point
SET point_name = metering_point_code
WHERE point_name IS NULL OR point_name = '';
