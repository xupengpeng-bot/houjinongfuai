CREATE TABLE IF NOT EXISTS billing_package (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  package_code varchar(64) NOT NULL,
  package_name varchar(128) NOT NULL,
  billing_mode varchar(32) NOT NULL,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0,
  unit_type varchar(32) NOT NULL,
  min_charge_amount numeric(12, 2) NOT NULL DEFAULT 0,
  scope_type varchar(32) NOT NULL,
  scope_ref_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, package_code)
);

CREATE TABLE IF NOT EXISTS well_runtime_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  well_id uuid NOT NULL REFERENCES well(id),
  billing_package_id uuid NOT NULL REFERENCES billing_package(id),
  power_threshold_kw numeric(10, 2),
  min_run_seconds integer,
  max_run_seconds integer,
  concurrency_limit integer,
  stop_protection_mode varchar(32) NOT NULL DEFAULT 'stop_pump_then_close_valve',
  safety_rule_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'draft',
  effective_from timestamptz NULL,
  effective_to timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interaction_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  target_type varchar(32) NOT NULL,
  scene_code varchar(64) NOT NULL,
  confirm_mode varchar(32) NOT NULL DEFAULT 'single_confirm',
  prompt_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  template_code varchar(64) NOT NULL,
  template_name varchar(128) NOT NULL,
  target_family varchar(32) NOT NULL,
  template_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_code)
);

CREATE TABLE IF NOT EXISTS topology_relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  source_type varchar(32) NOT NULL,
  source_id uuid NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id uuid NOT NULL,
  relation_type varchar(32) NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active',
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pump_valve_relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  well_id uuid NOT NULL REFERENCES well(id),
  pump_id uuid NOT NULL REFERENCES pump(id),
  valve_id uuid NOT NULL REFERENCES valve(id),
  relation_role varchar(16) NOT NULL,
  billing_inherit_mode varchar(32) NOT NULL DEFAULT 'well_policy',
  relation_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, well_id, pump_id, valve_id)
);

CREATE TABLE IF NOT EXISTS scan_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  scene_code varchar(64) NOT NULL,
  qr_code varchar(256) NOT NULL,
  parsed_target_type varchar(32) NOT NULL,
  parsed_target_id uuid NULL,
  expired_at timestamptz NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  scene_code varchar(64) NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id uuid NOT NULL,
  decision_result varchar(16) NOT NULL,
  blocking_reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_rule_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_preview_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_container (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  well_id uuid NOT NULL REFERENCES well(id),
  status varchar(32) NOT NULL DEFAULT 'pending',
  active_session_count integer NOT NULL DEFAULT 0,
  shared_resource_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  protection_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  session_no varchar(64) NOT NULL,
  runtime_container_id uuid NULL REFERENCES runtime_container(id),
  source_scan_ticket_id uuid NULL REFERENCES scan_ticket(id),
  source_decision_id uuid NULL REFERENCES runtime_decision(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  well_id uuid NOT NULL REFERENCES well(id),
  pump_id uuid NOT NULL REFERENCES pump(id),
  valve_id uuid NOT NULL REFERENCES valve(id),
  status varchar(32) NOT NULL,
  billing_started_at timestamptz NULL,
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  end_reason_code varchar(64) NULL,
  telemetry_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_no)
);

CREATE TABLE IF NOT EXISTS command_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  session_id uuid NOT NULL REFERENCES runtime_session(id),
  target_device_id uuid NOT NULL REFERENCES device(id),
  command_code varchar(32) NOT NULL,
  dispatch_status varchar(16) NOT NULL,
  request_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NULL,
  acked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
