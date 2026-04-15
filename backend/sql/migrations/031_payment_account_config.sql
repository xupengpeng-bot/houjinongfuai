create table if not exists payment_account (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  provider varchar(16) not null,
  account_code varchar(64) not null,
  account_name varchar(128) not null,
  merchant_no varchar(128) null,
  app_id varchar(128) null,
  account_identity varchar(128) null,
  config_json jsonb not null default '{}'::jsonb,
  remarks text null,
  is_default boolean not null default false,
  status varchar(16) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, account_code)
);

create table if not exists payment_account_project (
  payment_account_id uuid not null references payment_account(id) on delete cascade,
  project_id uuid not null references project(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (payment_account_id, project_id)
);

create unique index if not exists ux_payment_account_default_per_provider
  on payment_account (tenant_id, provider)
  where is_default = true;

create index if not exists ix_payment_account_provider_status
  on payment_account (tenant_id, provider, status, updated_at desc);

create index if not exists ix_payment_account_project_lookup
  on payment_account_project (project_id, payment_account_id);

alter table payment_intent
  add column if not exists payment_account_id uuid null references payment_account(id),
  add column if not exists payment_account_snapshot_json jsonb not null default '{}'::jsonb;
