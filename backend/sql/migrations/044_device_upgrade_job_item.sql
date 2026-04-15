create table if not exists device_upgrade_job_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null references device_upgrade_job(id) on delete cascade,
  device_id uuid not null references device(id) on delete cascade,
  release_id uuid not null references device_release_registry(id) on delete restrict,
  imei varchar(64) not null,
  device_code varchar(255),
  device_name varchar(255),
  target_version varchar(255) not null,
  upgrade_token varchar(128) not null unique,
  status varchar(32) not null default 'pending',
  stage varchar(64) not null default 'pending',
  progress_percent numeric(5,2) not null default 0,
  command_id uuid references device_command(id) on delete set null,
  command_token uuid,
  package_artifact_id uuid references device_release_artifact(id) on delete set null,
  package_file_name varchar(255),
  package_checksum varchar(255),
  last_error_code varchar(128),
  last_error_message text,
  detail_json jsonb not null default '{}'::jsonb,
  last_reported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_device_upgrade_job_item_job_id
  on device_upgrade_job_item (job_id, created_at desc);

create index if not exists ix_device_upgrade_job_item_device_id
  on device_upgrade_job_item (device_id, created_at desc);

create index if not exists ix_device_upgrade_job_item_status
  on device_upgrade_job_item (status, updated_at desc);

create index if not exists ix_device_upgrade_job_item_upgrade_token
  on device_upgrade_job_item (upgrade_token);
