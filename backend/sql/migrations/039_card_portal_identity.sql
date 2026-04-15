create table if not exists farmer_card_portal_user (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  provider varchar(16) not null,
  provider_user_key varchar(128) not null,
  mobile varchar(32) not null,
  display_name varchar(64) null,
  status varchar(24) not null default 'active',
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, provider_user_key)
);

create index if not exists ix_farmer_card_portal_user_mobile
  on farmer_card_portal_user (tenant_id, mobile, created_at desc);

create table if not exists farmer_card_portal_session (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  portal_user_id uuid not null references farmer_card_portal_user(id),
  session_token varchar(128) not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_farmer_card_portal_session_user
  on farmer_card_portal_session (tenant_id, portal_user_id, created_at desc);
