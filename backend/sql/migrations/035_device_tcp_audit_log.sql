-- 035_device_tcp_audit_log.sql
-- Temporary but durable TCP ingress audit log for debugging and joint testing.
-- Captures every inbound TCP frame before/around runtime event ingestion so
-- malformed frames, unregistered IMEIs, and rejected payloads are still traceable.

create table if not exists device_tcp_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  connection_id varchar(64) not null,
  transport_type varchar(16) not null default 'tcp',
  direction varchar(8) not null default 'inbound',
  remote_addr varchar(128) null,
  remote_port integer null,
  imei varchar(32) null,
  msg_type varchar(64) null,
  protocol_version varchar(32) null,
  frame_size_bytes integer not null default 0,
  raw_frame_text text not null default '',
  parse_status varchar(24) not null,
  ingest_status varchar(24) not null default 'pending',
  ingest_error text null,
  request_snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_device_tcp_audit_log_created_at
  on device_tcp_audit_log (created_at desc);

create index if not exists ix_device_tcp_audit_log_imei_created_at
  on device_tcp_audit_log (tenant_id, imei, created_at desc);

create index if not exists ix_device_tcp_audit_log_connection_created_at
  on device_tcp_audit_log (tenant_id, connection_id, created_at desc);

create index if not exists ix_device_tcp_audit_log_status_created_at
  on device_tcp_audit_log (tenant_id, parse_status, ingest_status, created_at desc);
