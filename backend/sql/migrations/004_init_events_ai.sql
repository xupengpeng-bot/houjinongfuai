CREATE TABLE IF NOT EXISTS session_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  session_id uuid NOT NULL REFERENCES runtime_session(id),
  from_status varchar(32),
  to_status varchar(32) NOT NULL,
  action_code varchar(64) NOT NULL,
  reason_code varchar(64),
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS irrigation_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  order_no varchar(64) NOT NULL,
  session_id uuid NOT NULL REFERENCES runtime_session(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  billing_package_id uuid NOT NULL REFERENCES billing_package(id),
  status varchar(32) NOT NULL,
  settlement_status varchar(16) NOT NULL,
  charge_duration_sec integer,
  charge_volume numeric(12, 2),
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  pricing_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_no)
);

CREATE TABLE IF NOT EXISTS alarm_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  alarm_code varchar(64) NOT NULL,
  source_type varchar(32) NOT NULL,
  source_id uuid NOT NULL,
  device_id uuid NULL REFERENCES device(id),
  session_id uuid NULL REFERENCES runtime_session(id),
  severity varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  trigger_reason_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_create_work_order boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  work_order_no varchar(64) NOT NULL,
  source_alarm_id uuid NULL REFERENCES alarm_event(id),
  source_session_id uuid NULL REFERENCES runtime_session(id),
  device_id uuid NULL REFERENCES device(id),
  work_order_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL,
  assignee_user_id uuid NULL REFERENCES sys_user(id),
  sla_deadline_at timestamptz NULL,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, work_order_no)
);

CREATE TABLE IF NOT EXISTS work_order_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  work_order_id uuid NOT NULL REFERENCES work_order(id),
  action_code varchar(64) NOT NULL,
  from_status varchar(32),
  to_status varchar(32) NOT NULL,
  operator_id uuid NULL REFERENCES sys_user(id),
  remark text,
  attachment_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uat_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  case_code varchar(64) NOT NULL,
  role_type varchar(32) NOT NULL,
  scenario_name varchar(128) NOT NULL,
  expected_result text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_code)
);

CREATE TABLE IF NOT EXISTS uat_execution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  execution_no varchar(64) NOT NULL,
  case_id uuid NOT NULL REFERENCES uat_case(id),
  executor_user_id uuid NULL REFERENCES sys_user(id),
  status varchar(16) NOT NULL,
  block_reason_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, execution_no)
);

CREATE TABLE IF NOT EXISTS ai_conversation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  channel varchar(16) NOT NULL,
  user_id uuid NOT NULL REFERENCES sys_user(id),
  status varchar(16) NOT NULL,
  topic varchar(128),
  latest_intent varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  conversation_id uuid NOT NULL REFERENCES ai_conversation(id),
  role_type varchar(16) NOT NULL,
  content_text text NOT NULL,
  tool_calls_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level varchar(16) NOT NULL DEFAULT 'low',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  channel varchar(16) NOT NULL,
  external_user_id varchar(128) NOT NULL,
  platform_user_id uuid NOT NULL REFERENCES sys_user(id),
  binding_status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, external_user_id)
);

CREATE TABLE IF NOT EXISTS conversation_context_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  conversation_id uuid NOT NULL REFERENCES ai_conversation(id),
  current_session_id uuid NULL REFERENCES runtime_session(id),
  last_order_id uuid NULL REFERENCES irrigation_order(id),
  bound_device_id uuid NULL REFERENCES device(id),
  region_id uuid NULL REFERENCES region(id),
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_handoff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  conversation_id uuid NOT NULL REFERENCES ai_conversation(id),
  handoff_type varchar(32) NOT NULL,
  status varchar(16) NOT NULL,
  target_work_order_id uuid NULL REFERENCES work_order(id),
  handoff_reason_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  actor_user_id uuid NULL REFERENCES sys_user(id),
  module_code varchar(64) NOT NULL,
  resource_type varchar(64) NOT NULL,
  resource_id uuid NULL,
  action_code varchar(64) NOT NULL,
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  trace_id varchar(64) NOT NULL,
  module_code varchar(64) NOT NULL,
  level varchar(16) NOT NULL,
  message text NOT NULL,
  extra_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
