-- 045_device_card_audit_log.sql
-- Query-oriented device card audit log, independent from order/session business outcomes.

create table if not exists device_card_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  device_id uuid null references device(id),
  message_log_id uuid null,
  imei varchar(64) not null,
  msg_id varchar(128) null,
  seq_no integer null,
  msg_type varchar(32) not null,
  event_type varchar(64) null,
  event_code varchar(64) null,
  reason_code varchar(64) null,
  audit_outcome varchar(32) null,
  audit_source varchar(64) null,
  swipe_action varchar(16) null,
  swipe_event_id varchar(128) null,
  target_ref varchar(32) null,
  card_token varchar(64) null,
  card_token_suffix varchar(16) null,
  occurred_at timestamptz null,
  server_rx_ts timestamptz not null,
  idempotency_key varchar(255) not null,
  raw_message text null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists ix_device_card_audit_log_imei_created
  on device_card_audit_log (tenant_id, imei, created_at desc);

create index if not exists ix_device_card_audit_log_card_suffix_created
  on device_card_audit_log (tenant_id, card_token_suffix, created_at desc);

create index if not exists ix_device_card_audit_log_event_code_created
  on device_card_audit_log (tenant_id, event_code, created_at desc);

create index if not exists ix_device_card_audit_log_server_rx
  on device_card_audit_log (tenant_id, server_rx_ts desc, id desc);
