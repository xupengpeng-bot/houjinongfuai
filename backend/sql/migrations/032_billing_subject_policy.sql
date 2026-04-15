create table if not exists billing_subject_policy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  subject_type varchar(16) not null,
  subject_id uuid not null,
  billing_package_id uuid not null references billing_package(id),
  config_source varchar(32) not null default 'manual',
  status varchar(16) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_billing_subject_policy_subject_type
    check (subject_type in ('well', 'pump', 'valve')),
  constraint chk_billing_subject_policy_status
    check (status in ('active', 'inactive')),
  constraint ux_billing_subject_policy_subject
    unique (tenant_id, subject_type, subject_id)
);

create index if not exists ix_billing_subject_policy_subject_type
  on billing_subject_policy (tenant_id, subject_type, status, updated_at desc);

create index if not exists ix_billing_subject_policy_package
  on billing_subject_policy (tenant_id, billing_package_id, updated_at desc);
