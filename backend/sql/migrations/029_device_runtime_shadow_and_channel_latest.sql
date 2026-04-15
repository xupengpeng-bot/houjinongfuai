-- 029_device_runtime_shadow_and_channel_latest.sql
-- Runtime latest-state tables for controller integration.

CREATE TABLE IF NOT EXISTS device_runtime_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  device_id uuid NOT NULL REFERENCES device(id),
  imei varchar(32) NOT NULL,
  project_id uuid NULL REFERENCES project(id),
  block_id uuid NULL REFERENCES project_block(id),
  source_node_code varchar(64) NULL,
  last_msg_id varchar(128) NULL,
  last_seq_no integer NULL,
  last_msg_type varchar(64) NULL,
  last_device_ts timestamptz NULL,
  last_server_rx_ts timestamptz NULL,
  last_heartbeat_at timestamptz NULL,
  last_snapshot_at timestamptz NULL,
  last_event_at timestamptz NULL,
  connection_state varchar(16) NOT NULL DEFAULT 'disconnected',
  online_state varchar(16) NOT NULL DEFAULT 'offline',
  workflow_state varchar(32) NULL,
  run_state varchar(32) NULL,
  power_state varchar(32) NULL,
  ready boolean NOT NULL DEFAULT false,
  config_version integer NULL,
  firmware_family varchar(64) NULL,
  firmware_version varchar(64) NULL,
  signal_csq integer NULL,
  signal_rsrp integer NULL,
  battery_soc numeric(5,2) NULL,
  battery_voltage numeric(10,3) NULL,
  solar_voltage numeric(10,3) NULL,
  alarm_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_status_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  module_states_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_command_id uuid NULL REFERENCES device_command(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_runtime_shadow_tenant_device
  ON device_runtime_shadow (tenant_id, device_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_runtime_shadow_tenant_imei
  ON device_runtime_shadow (tenant_id, imei);

CREATE INDEX IF NOT EXISTS ix_device_runtime_shadow_project_block
  ON device_runtime_shadow (tenant_id, project_id, block_id);

CREATE INDEX IF NOT EXISTS ix_device_runtime_shadow_conn_state
  ON device_runtime_shadow (tenant_id, connection_state, online_state);

CREATE INDEX IF NOT EXISTS ix_device_runtime_shadow_workflow_state
  ON device_runtime_shadow (tenant_id, workflow_state);


CREATE TABLE IF NOT EXISTS device_channel_latest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  device_id uuid NOT NULL REFERENCES device(id),
  imei varchar(32) NOT NULL,
  project_id uuid NULL REFERENCES project(id),
  block_id uuid NULL REFERENCES project_block(id),
  source_node_code varchar(64) NULL,
  module_code varchar(64) NOT NULL,
  module_instance_code varchar(64) NULL,
  channel_code varchar(64) NOT NULL,
  metric_code varchar(64) NOT NULL,
  value_num numeric(18,6) NULL,
  value_text text NULL,
  unit varchar(32) NULL,
  quality varchar(32) NULL,
  fault_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  collected_at timestamptz NULL,
  server_rx_ts timestamptz NULL,
  last_msg_id varchar(128) NULL,
  last_seq_no integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_channel_latest_imei_channel_metric
  ON device_channel_latest (tenant_id, imei, channel_code, metric_code);

CREATE INDEX IF NOT EXISTS ix_device_channel_latest_project_block
  ON device_channel_latest (tenant_id, project_id, block_id);

CREATE INDEX IF NOT EXISTS ix_device_channel_latest_device_updated
  ON device_channel_latest (tenant_id, device_id, updated_at desc);

CREATE INDEX IF NOT EXISTS ix_device_channel_latest_metric_updated
  ON device_channel_latest (tenant_id, metric_code, updated_at desc);
