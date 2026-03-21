CREATE TABLE IF NOT EXISTS region (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  parent_id uuid NULL REFERENCES region(id),
  region_code varchar(64) NOT NULL,
  region_name varchar(128) NOT NULL,
  region_type varchar(32) NOT NULL,
  full_path varchar(512) NOT NULL DEFAULT '',
  manager_user_id uuid NULL REFERENCES sys_user(id),
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, region_code)
);

CREATE TABLE IF NOT EXISTS device_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  type_code varchar(64) NOT NULL,
  type_name varchar(128) NOT NULL,
  family varchar(32) NOT NULL,
  capability_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  form_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type_code)
);

CREATE TABLE IF NOT EXISTS device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  device_type_id uuid NOT NULL REFERENCES device_type(id),
  region_id uuid NOT NULL REFERENCES region(id),
  device_code varchar(64) NOT NULL,
  device_name varchar(128) NOT NULL,
  serial_no varchar(128),
  protocol_type varchar(32),
  online_state varchar(16) NOT NULL DEFAULT 'unknown',
  lifecycle_state varchar(16) NOT NULL DEFAULT 'draft',
  runtime_state varchar(16) NOT NULL DEFAULT 'idle',
  install_time timestamptz NULL,
  last_heartbeat_at timestamptz NULL,
  ext_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_code)
);

CREATE TABLE IF NOT EXISTS well (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  device_id uuid NOT NULL UNIQUE REFERENCES device(id),
  well_code varchar(64) NOT NULL,
  water_source_type varchar(32) NOT NULL,
  rated_flow numeric(12, 2),
  rated_pressure numeric(12, 2),
  max_concurrency integer,
  safety_profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, well_code)
);

CREATE TABLE IF NOT EXISTS pump (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  device_id uuid NOT NULL UNIQUE REFERENCES device(id),
  well_id uuid NOT NULL REFERENCES well(id),
  pump_code varchar(64) NOT NULL,
  rated_power_kw numeric(10, 2),
  startup_timeout_sec integer,
  stop_timeout_sec integer,
  power_meter_device_id uuid NULL REFERENCES device(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, pump_code)
);

CREATE TABLE IF NOT EXISTS valve (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  device_id uuid NOT NULL UNIQUE REFERENCES device(id),
  well_id uuid NOT NULL REFERENCES well(id),
  valve_code varchar(64) NOT NULL,
  valve_kind varchar(32) NOT NULL,
  open_timeout_sec integer,
  close_timeout_sec integer,
  farmland_region_id uuid NULL REFERENCES region(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, valve_code)
);
