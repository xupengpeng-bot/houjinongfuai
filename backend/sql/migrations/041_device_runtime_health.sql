-- 041_device_runtime_health.sql
-- Device online-state machine, offline/reboot event journal, and daily health aggregates.

create table if not exists device_runtime_status (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  device_id uuid not null references device(id),
  imei varchar(32) not null,
  is_online boolean not null default false,
  online_state varchar(32) not null default 'offline_confirmed',
  status_reason varchar(64) null,
  last_seen_at timestamptz null,
  last_heartbeat_at timestamptz null,
  last_snapshot_at timestamptz null,
  last_register_at timestamptz null,
  last_recovered_at timestamptz null,
  current_boot_session_id varchar(128) null,
  current_uptime_sec integer null,
  current_reset_cause varchar(128) null,
  firmware_version varchar(64) null,
  hardware_rev varchar(64) null,
  today_register_count integer not null default 0,
  register_count_last_hour integer not null default 0,
  register_alert_level varchar(16) null,
  network_lost_count integer null,
  power_loss_count integer null,
  last_disconnect_reason varchar(64) null,
  last_disconnect_conn_age_ms integer null,
  last_disconnect_last_tx_type varchar(64) null,
  last_disconnect_signature varchar(256) null,
  peer_close_suspect_streak integer not null default 0,
  frequent_reboot_recovery_streak integer not null default 0,
  health_flags_json jsonb not null default '[]'::jsonb,
  last_offline_started_at timestamptz null,
  last_offline_ended_at timestamptz null,
  last_offline_duration_sec integer null,
  last_recover_msg_type varchar(64) null,
  last_recover_boot_session_id varchar(128) null,
  last_reboot_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, device_id),
  unique (tenant_id, imei)
);

create index if not exists ix_device_runtime_status_online
  on device_runtime_status (tenant_id, online_state, is_online);

create index if not exists ix_device_runtime_status_last_seen
  on device_runtime_status (tenant_id, last_seen_at desc);

create index if not exists ix_device_runtime_status_last_heartbeat
  on device_runtime_status (tenant_id, last_heartbeat_at desc);

create table if not exists device_offline_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  device_id uuid not null references device(id),
  imei varchar(32) not null,
  offline_state varchar(32) not null default 'offline_suspected',
  offline_started_at timestamptz not null,
  offline_confirmed_at timestamptz null,
  offline_ended_at timestamptz null,
  offline_duration_sec integer null,
  recover_msg_type varchar(64) null,
  recover_boot_session_id varchar(128) null,
  offline_start_boot_session_id varchar(128) null,
  status varchar(16) not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_device_offline_events_open
  on device_offline_events (tenant_id, device_id)
  where status = 'open';

create index if not exists ix_device_offline_events_device_started
  on device_offline_events (tenant_id, device_id, offline_started_at desc);

create index if not exists ix_device_offline_events_imei_started
  on device_offline_events (tenant_id, imei, offline_started_at desc);

create table if not exists device_reboot_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  device_id uuid not null references device(id),
  imei varchar(32) not null,
  detected_at timestamptz not null,
  reason_type varchar(32) not null,
  previous_boot_session_id varchar(128) null,
  current_boot_session_id varchar(128) null,
  previous_uptime_sec integer null,
  current_uptime_sec integer null,
  reset_cause varchar(128) null,
  source_msg_type varchar(64) null,
  source_msg_id varchar(128) null,
  created_at timestamptz not null default now()
);

create index if not exists ix_device_reboot_events_device_detected
  on device_reboot_events (tenant_id, device_id, detected_at desc);

create index if not exists ix_device_reboot_events_imei_detected
  on device_reboot_events (tenant_id, imei, detected_at desc);

create table if not exists device_health_daily (
  tenant_id uuid not null references tenant(id),
  device_id uuid not null references device(id),
  day date not null,
  imei varchar(32) not null,
  offline_count integer not null default 0,
  offline_total_sec integer not null default 0,
  availability numeric(7,4) not null default 1,
  register_count integer not null default 0,
  reboot_count integer not null default 0,
  peer_close_suspect_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, device_id, day)
);

create index if not exists ix_device_health_daily_day
  on device_health_daily (tenant_id, day desc);

create index if not exists ix_device_health_daily_imei_day
  on device_health_daily (tenant_id, imei, day desc);

alter table card_swipe_event
  add column if not exists result_category varchar(32) null,
  add column if not exists result_code varchar(64) null,
  add column if not exists result_message text null,
  add column if not exists awaiting_device_ack boolean not null default false,
  add column if not exists resolved_at timestamptz null;

create index if not exists ix_card_swipe_event_result_category
  on card_swipe_event (tenant_id, result_category, created_at desc);
