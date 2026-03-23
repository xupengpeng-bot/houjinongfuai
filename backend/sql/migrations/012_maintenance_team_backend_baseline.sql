create table if not exists maintenance_team (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  team_name varchar(128) not null,
  leader_name varchar(128) not null,
  contact_phone varchar(32) not null,
  status varchar(16) not null default 'active',
  remarks text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, team_name)
);

alter table project add column if not exists maintenance_team_id uuid null references maintenance_team(id);
alter table asset add column if not exists maintenance_team_id uuid null references maintenance_team(id);

create index if not exists idx_project_maintenance_team_id on project(maintenance_team_id);
create index if not exists idx_asset_maintenance_team_id on asset(maintenance_team_id);
