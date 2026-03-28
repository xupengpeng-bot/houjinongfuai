-- 018_device_domain_baseline.sql
-- COD-2026-03-27-026: additive device configuration baseline — optional asset binding
-- Does not change runtime_session / billing semantics.

ALTER TABLE device
  ADD COLUMN IF NOT EXISTS asset_id uuid NULL REFERENCES asset (id);

CREATE INDEX IF NOT EXISTS idx_device_asset_id ON device (tenant_id, asset_id)
  WHERE asset_id IS NOT NULL;

COMMENT ON COLUMN device.asset_id IS 'Optional ops binding to asset; IMEI remains canonical device business key.';
