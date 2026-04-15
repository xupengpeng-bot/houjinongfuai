create table if not exists farmer_card_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  card_token varchar(64) not null,
  user_id uuid null references sys_user(id),
  status varchar(24) not null default 'unregistered',
  label varchar(128) null,
  batch_no varchar(64) null,
  holder_name varchar(64) null,
  holder_mobile varchar(32) null,
  source_type varchar(32) not null default 'import',
  ext_json jsonb not null default '{}'::jsonb,
  registered_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, card_token)
);

create index if not exists ix_farmer_card_catalog_status
  on farmer_card_catalog (tenant_id, status, created_at desc);

create index if not exists ix_farmer_card_catalog_user
  on farmer_card_catalog (tenant_id, user_id, created_at desc);

create index if not exists ix_farmer_card_catalog_mobile
  on farmer_card_catalog (tenant_id, holder_mobile);

create table if not exists farmer_card_recharge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  card_catalog_id uuid not null references farmer_card_catalog(id),
  user_id uuid not null references sys_user(id),
  payment_intent_id uuid not null,
  payment_channel varchar(32) not null,
  recharge_mode varchar(16) not null default 'self',
  amount numeric(12, 2) not null default 0,
  status varchar(24) not null default 'created',
  holder_mobile varchar(32) null,
  payer_mobile varchar(32) null,
  request_snapshot_json jsonb not null default '{}'::jsonb,
  provider_payload_json jsonb not null default '{}'::jsonb,
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_intent_id)
);

create index if not exists ix_farmer_card_recharge_card
  on farmer_card_recharge (tenant_id, card_catalog_id, created_at desc);

create index if not exists ix_farmer_card_recharge_user
  on farmer_card_recharge (tenant_id, user_id, created_at desc);

insert into farmer_card_catalog (
  tenant_id,
  card_token,
  user_id,
  status,
  label,
  holder_name,
  holder_mobile,
  source_type,
  registered_at,
  created_at,
  updated_at
)
select
  fc.tenant_id,
  fc.card_token,
  fc.user_id,
  case when fc.status = 'active' then 'active' else coalesce(fc.status, 'active') end,
  fc.label,
  su.display_name,
  su.mobile,
  'legacy_bind',
  fc.created_at,
  fc.created_at,
  fc.updated_at
from farmer_card fc
left join sys_user su on su.id = fc.user_id
on conflict (tenant_id, card_token) do update set
  user_id = excluded.user_id,
  status = excluded.status,
  label = coalesce(excluded.label, farmer_card_catalog.label),
  holder_name = coalesce(excluded.holder_name, farmer_card_catalog.holder_name),
  holder_mobile = coalesce(excluded.holder_mobile, farmer_card_catalog.holder_mobile),
  registered_at = coalesce(excluded.registered_at, farmer_card_catalog.registered_at),
  updated_at = now();
