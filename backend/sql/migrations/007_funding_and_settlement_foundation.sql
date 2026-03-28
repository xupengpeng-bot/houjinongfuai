-- 007_funding_and_settlement_foundation.sql
-- Phase 1 batch-1 additive funding/settlement foundation.
-- Compatibility / backfill strategy:
-- 1. Existing irrigation_order records keep current semantics if new fields are NULL/default.
-- 2. New funding fields use nullable/default-safe values to avoid breaking current seeds and runtime flows.
-- 3. Existing rows are backfilled only for device_key from related runtime_session when possible.
-- 4. No current API behavior changes in this batch; structures are preparatory only.
-- 5. Rollback strategy: remove new tables first, then additive columns/indexes from irrigation_order.

ALTER TABLE irrigation_order
  ADD COLUMN IF NOT EXISTS order_channel varchar(16) NULL,
  ADD COLUMN IF NOT EXISTS funding_mode varchar(24) NULL,
  ADD COLUMN IF NOT EXISTS settle_basis varchar(16) NULL,
  ADD COLUMN IF NOT EXISTS usage_source varchar(32) NOT NULL DEFAULT 'DEVICE_COUNTER',
  ADD COLUMN IF NOT EXISTS device_key varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS pricing_package_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prepaid_amount numeric(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS held_amount numeric(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS released_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accrued_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_settled_msg_id varchar(128) NULL,
  ADD COLUMN IF NOT EXISTS last_settled_seq_no integer NULL;

UPDATE irrigation_order io
SET device_key = rs.device_key
FROM runtime_session rs
WHERE io.session_id = rs.id
  AND io.device_key IS NULL
  AND rs.device_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_irrigation_order_device_key
  ON irrigation_order (tenant_id, device_key)
  WHERE device_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_settlement_slice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  order_id uuid NOT NULL REFERENCES irrigation_order(id),
  session_id uuid NOT NULL REFERENCES runtime_session(id),
  imei varchar(32) NOT NULL,
  seq_no integer NULL,
  settle_basis varchar(16) NOT NULL,
  basis_type varchar(32) NOT NULL,
  period_start_ts timestamptz NULL,
  period_end_ts timestamptz NULL,
  delta_usage numeric(18, 6) NOT NULL DEFAULT 0,
  delta_amount numeric(12, 2) NOT NULL DEFAULT 0,
  pricing_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_msg_id varchar(128) NULL,
  idempotency_key varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_settlement_slice_idempotency
  ON order_settlement_slice (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS ix_order_settlement_slice_order
  ON order_settlement_slice (tenant_id, order_id, created_at);

CREATE TABLE IF NOT EXISTS order_funding_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  order_id uuid NOT NULL REFERENCES irrigation_order(id),
  session_id uuid NULL REFERENCES runtime_session(id),
  imei varchar(32) NULL,
  entry_type varchar(32) NOT NULL,
  funding_mode varchar(24) NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  balance_after numeric(12, 2) NULL,
  reference_code varchar(64) NULL,
  idempotency_key varchar(160) NOT NULL,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_funding_ledger_idempotency
  ON order_funding_ledger (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS ix_order_funding_ledger_order
  ON order_funding_ledger (tenant_id, order_id, created_at);
