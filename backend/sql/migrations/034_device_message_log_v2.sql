-- 034_device_message_log_v2.sql
-- Phase 1 interaction log foundation upgrade:
-- 1. Keep device_message_log as legacy history table for compatibility.
-- 2. New writes switch to device_message_log_v2, which is partitioned by server_rx_ts.
-- 3. device_message_log_v2_dedup preserves idempotency semantics that cannot be expressed
--    as a global unique index on a partitioned table.

CREATE TABLE IF NOT EXISTS device_message_log_v2 (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  imei varchar(32) NOT NULL,
  device_id uuid NULL REFERENCES device(id),
  connection_id varchar(64) NULL,
  protocol_version varchar(32) NOT NULL DEFAULT 'tcp-json-v1',
  direction varchar(8) NOT NULL,
  msg_id varchar(128) NULL,
  seq_no integer NULL,
  msg_type varchar(64) NOT NULL,
  event_type varchar(96) NULL,
  session_ref varchar(64) NULL,
  command_id uuid NULL REFERENCES device_command(id),
  device_ts timestamptz NULL,
  server_rx_ts timestamptz NOT NULL DEFAULT now(),
  idempotency_key varchar(160) NOT NULL,
  ordering_key varchar(160) NOT NULL,
  integrity_ok boolean NOT NULL DEFAULT true,
  clock_drift_sec integer NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_preview_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_size_bytes integer NOT NULL DEFAULT 0,
  raw_body_text text NULL,
  raw_body_ref varchar(512) NULL,
  storage_tier varchar(16) NOT NULL DEFAULT 'hot',
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (server_rx_ts);

CREATE TABLE IF NOT EXISTS device_message_log_v2_default
  PARTITION OF device_message_log_v2 DEFAULT;

DO $$
DECLARE
  month_start date := date_trunc('month', now())::date;
  next_month_start date := (date_trunc('month', now()) + interval '1 month')::date;
  after_next_month_start date := (date_trunc('month', now()) + interval '2 month')::date;
  current_partition_name text := format('device_message_log_v2_%s', to_char(month_start, 'YYYYMM'));
  next_partition_name text := format('device_message_log_v2_%s', to_char(next_month_start, 'YYYYMM'));
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF device_message_log_v2
       FOR VALUES FROM (%L) TO (%L)',
    current_partition_name,
    month_start::text,
    next_month_start::text
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF device_message_log_v2
       FOR VALUES FROM (%L) TO (%L)',
    next_partition_name,
    next_month_start::text,
    after_next_month_start::text
  );
END $$;

CREATE TABLE IF NOT EXISTS device_message_log_v2_dedup (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  idempotency_key varchar(160) NOT NULL,
  log_id uuid NOT NULL,
  server_rx_ts timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_device_message_log_v2_id
  ON device_message_log_v2 (id);

CREATE INDEX IF NOT EXISTS ix_device_message_log_v2_imei_server_rx
  ON device_message_log_v2 (tenant_id, imei, server_rx_ts desc);

CREATE INDEX IF NOT EXISTS ix_device_message_log_v2_device_server_rx
  ON device_message_log_v2 (tenant_id, device_id, server_rx_ts desc);

CREATE INDEX IF NOT EXISTS ix_device_message_log_v2_session_server_rx
  ON device_message_log_v2 (tenant_id, session_ref, server_rx_ts desc);

CREATE INDEX IF NOT EXISTS ix_device_message_log_v2_command_server_rx
  ON device_message_log_v2 (tenant_id, command_id, server_rx_ts desc);

CREATE INDEX IF NOT EXISTS ix_device_message_log_v2_msg_lookup
  ON device_message_log_v2 (tenant_id, imei, msg_id, seq_no, msg_type);
