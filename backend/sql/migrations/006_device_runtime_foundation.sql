-- 006_device_runtime_foundation.sql
-- Phase 1 batch-1 additive foundation only.
-- Compatibility / backfill strategy:
-- 1. Canonical device entity remains "device". No parallel "device_ledger" base table is introduced.
-- 2. Existing runtime_session / irrigation_order behavior must remain unchanged after this migration.
-- 3. New columns are nullable or have safe defaults so current seed and e2e continue to pass unchanged.
-- 4. Existing rows are backfilled conservatively in-place where the value is derivable; otherwise NULL/default is preserved.
-- 5. Rollback strategy: drop newly created indexes/tables first, then drop additive columns. No existing column is renamed or removed.

ALTER TABLE device
  ADD COLUMN IF NOT EXISTS imei varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS protocol_version varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS last_device_ts timestamptz NULL,
  ADD COLUMN IF NOT EXISTS connection_state varchar(16) NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS protocol_config_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE device
SET protocol_version = coalesce(protocol_version, protocol_type, 'tcp-json-v1')
WHERE protocol_version IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_tenant_imei_not_null
  ON device (tenant_id, imei)
  WHERE imei IS NOT NULL;

ALTER TABLE runtime_session
  ADD COLUMN IF NOT EXISTS session_ref varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS device_key varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS start_command_id uuid NULL,
  ADD COLUMN IF NOT EXISTS stop_command_id uuid NULL,
  ADD COLUMN IF NOT EXISTS command_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS device_acked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_event_seq_no integer NULL,
  ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 0;

UPDATE runtime_session rs
SET device_key = d.imei
FROM pump p
JOIN device d ON d.id = p.device_id
WHERE rs.pump_id = p.id
  AND rs.device_key IS NULL
  AND d.imei IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_runtime_session_session_ref_not_null
  ON runtime_session (tenant_id, session_ref)
  WHERE session_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_connection_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  imei varchar(32) NOT NULL,
  device_id uuid NULL REFERENCES device(id),
  connection_id varchar(64) NOT NULL,
  transport_type varchar(32) NOT NULL DEFAULT 'tcp',
  protocol_version varchar(32) NOT NULL DEFAULT 'tcp-json-v1',
  remote_addr varchar(128) NULL,
  remote_port integer NULL,
  connection_status varchar(16) NOT NULL DEFAULT 'connected',
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz NULL,
  superseded_by_connection_id varchar(64) NULL,
  audit_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_connection_active_imei
  ON device_connection_session (tenant_id, imei)
  WHERE disconnected_at IS NULL;

CREATE TABLE IF NOT EXISTS device_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  imei varchar(32) NOT NULL,
  device_id uuid NULL REFERENCES device(id),
  connection_id varchar(64) NULL,
  protocol_version varchar(32) NOT NULL DEFAULT 'tcp-json-v1',
  direction varchar(8) NOT NULL,
  msg_id varchar(128) NULL,
  seq_no integer NULL,
  msg_type varchar(64) NOT NULL,
  session_ref varchar(64) NULL,
  command_id uuid NULL,
  device_ts timestamptz NULL,
  server_rx_ts timestamptz NOT NULL DEFAULT now(),
  idempotency_key varchar(160) NOT NULL,
  ordering_key varchar(160) NOT NULL,
  integrity_ok boolean NOT NULL DEFAULT true,
  clock_drift_sec integer NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_message_idempotency_key
  ON device_message_log (tenant_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_message_imei_msg_id_not_null
  ON device_message_log (tenant_id, imei, msg_id)
  WHERE msg_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_message_imei_seq_type_not_null
  ON device_message_log (tenant_id, imei, seq_no, msg_type)
  WHERE seq_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_device_message_imei_seq
  ON device_message_log (tenant_id, imei, seq_no);

CREATE TABLE IF NOT EXISTS device_command (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  session_id uuid NULL REFERENCES runtime_session(id),
  order_id uuid NULL REFERENCES irrigation_order(id),
  target_device_id uuid NULL REFERENCES device(id),
  imei varchar(32) NOT NULL,
  command_code varchar(32) NOT NULL,
  command_status varchar(24) NOT NULL DEFAULT 'created',
  start_token varchar(64) NULL,
  session_ref varchar(64) NULL,
  request_msg_id varchar(128) NULL,
  request_seq_no integer NULL,
  ack_msg_id varchar(128) NULL,
  ack_seq_no integer NULL,
  sent_at timestamptz NULL,
  acked_at timestamptz NULL,
  failed_at timestamptz NULL,
  timeout_at timestamptz NULL,
  request_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_command_command_id
  ON device_command (tenant_id, command_id);

CREATE INDEX IF NOT EXISTS ix_device_command_imei_status
  ON device_command (tenant_id, imei, command_status);
