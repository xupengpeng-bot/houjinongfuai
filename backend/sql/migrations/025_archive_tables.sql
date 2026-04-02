-- COD-2026-04-02-001
-- Archive tables for active-domain cleanup and traceability.

CREATE TABLE IF NOT EXISTS device_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  origin_device_id uuid NOT NULL,
  origin_device_code varchar(64) NOT NULL,
  entity_name varchar(255) NULL,
  released_device_code varchar(64) NOT NULL,
  archive_reason varchar(64) NOT NULL,
  reason_text text NULL,
  trigger_type varchar(64) NOT NULL,
  source_module varchar(64) NOT NULL,
  source_action varchar(128) NOT NULL,
  ui_entry varchar(128) NULL,
  request_id varchar(64) NULL,
  batch_id varchar(64) NULL,
  operator_id uuid NULL REFERENCES sys_user(id),
  operator_name varchar(128) NULL,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_archive_tenant_origin_id
  ON device_archive (tenant_id, origin_device_id);

CREATE INDEX IF NOT EXISTS idx_device_archive_tenant_origin_code
  ON device_archive (tenant_id, origin_device_code);

CREATE INDEX IF NOT EXISTS idx_device_archive_archived_at
  ON device_archive (archived_at desc);

CREATE TABLE IF NOT EXISTS asset_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  origin_asset_id uuid NOT NULL,
  origin_asset_code varchar(64) NOT NULL,
  entity_name varchar(255) NULL,
  archive_reason varchar(64) NOT NULL,
  reason_text text NULL,
  trigger_type varchar(64) NOT NULL,
  source_module varchar(64) NOT NULL,
  source_action varchar(128) NOT NULL,
  ui_entry varchar(128) NULL,
  request_id varchar(64) NULL,
  batch_id varchar(64) NULL,
  operator_id uuid NULL REFERENCES sys_user(id),
  operator_name varchar(128) NULL,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_archive_tenant_origin_id
  ON asset_archive (tenant_id, origin_asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_archive_tenant_origin_code
  ON asset_archive (tenant_id, origin_asset_code);

CREATE INDEX IF NOT EXISTS idx_asset_archive_archived_at
  ON asset_archive (archived_at desc);

CREATE TABLE IF NOT EXISTS archive_operation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  archive_table varchar(64) NOT NULL,
  archive_record_id uuid NOT NULL,
  origin_table varchar(64) NOT NULL,
  origin_id uuid NOT NULL,
  origin_code varchar(64) NULL,
  entity_name varchar(255) NULL,
  operation_type varchar(32) NOT NULL DEFAULT 'archive',
  trigger_type varchar(64) NOT NULL,
  archive_reason varchar(64) NOT NULL,
  reason_text text NULL,
  source_module varchar(64) NOT NULL,
  source_action varchar(128) NOT NULL,
  ui_entry varchar(128) NULL,
  request_id varchar(64) NULL,
  batch_id varchar(64) NULL,
  operator_id uuid NULL REFERENCES sys_user(id),
  operator_name varchar(128) NULL,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archive_operation_log_origin
  ON archive_operation_log (tenant_id, origin_table, origin_id);

CREATE INDEX IF NOT EXISTS idx_archive_operation_log_archive_ref
  ON archive_operation_log (archive_table, archive_record_id);

CREATE INDEX IF NOT EXISTS idx_archive_operation_log_created_at
  ON archive_operation_log (created_at desc);
