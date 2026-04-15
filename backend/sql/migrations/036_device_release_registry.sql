-- 036_device_release_registry.sql
-- Lightweight device release registry and local artifact storage metadata.

create table if not exists device_release_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  device_type_id uuid not null references device_type(id),
  release_kind varchar(16) not null,
  release_code varchar(128) not null,
  family varchar(64) null,
  version_semver varchar(32) null,
  hardware_sku varchar(64) null,
  hardware_rev varchar(32) null,
  protocol_version varchar(32) null,
  package_name varchar(255) null,
  package_size_kb integer not null default 0,
  checksum varchar(128) null,
  release_notes text not null default '',
  source_repo_url text null,
  source_repo_ref varchar(128) null,
  source_commit_sha varchar(64) null,
  status varchar(24) not null default 'released',
  created_by varchar(64) not null default 'ops-admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_device_release_kind check (release_kind in ('software', 'embedded', 'hardware')),
  constraint ck_device_release_status check (status in ('draft', 'released', 'deprecated'))
);

create unique index if not exists ux_device_release_registry_code
  on device_release_registry (tenant_id, release_code);

create index if not exists ix_device_release_registry_type_created_at
  on device_release_registry (tenant_id, device_type_id, created_at desc);

create table if not exists device_release_artifact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  release_id uuid not null references device_release_registry(id) on delete cascade,
  artifact_kind varchar(24) not null,
  file_name varchar(255) not null,
  content_type varchar(128) not null default 'application/octet-stream',
  file_size_bytes integer not null default 0,
  storage_path text not null,
  created_at timestamptz not null default now(),
  constraint ck_device_release_artifact_kind check (artifact_kind in ('binary', 'source', 'document'))
);

create index if not exists ix_device_release_artifact_release
  on device_release_artifact (tenant_id, release_id, created_at asc);

create table if not exists device_upgrade_job (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  scope varchar(16) not null,
  device_id uuid null references device(id),
  device_type_id uuid null references device_type(id),
  release_id uuid not null references device_release_registry(id),
  target_version varchar(128) not null,
  status varchar(24) not null default 'pending',
  total_devices integer not null default 1,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  created_by varchar(64) not null default 'ops-admin',
  project_name varchar(128) null,
  block_name varchar(128) null,
  batch_strategy varchar(32) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_device_upgrade_job_scope check (scope in ('single', 'batch')),
  constraint ck_device_upgrade_job_status check (status in ('pending', 'running', 'partial_success', 'success', 'failed', 'paused'))
);

create index if not exists ix_device_upgrade_job_created_at
  on device_upgrade_job (tenant_id, created_at desc);
