alter table billing_package
  add column if not exists pricing_rules_json jsonb not null default '{}'::jsonb;

alter table farmer_wallet
  add column if not exists locked_balance numeric(12, 2) not null default 0;

alter table farmer_wallet_ledger
  add column if not exists locked_balance_after numeric(12, 2) not null default 0;

update farmer_wallet_ledger
set locked_balance_after = 0
where locked_balance_after is null;

alter table irrigation_order
  add column if not exists target_device_id uuid null references device(id),
  add column if not exists target_imei varchar(64) null,
  add column if not exists target_device_role varchar(32) null,
  add column if not exists payment_mode varchar(32) null,
  add column if not exists payment_status varchar(32) not null default 'unpaid',
  add column if not exists prepaid_amount numeric(12, 2) not null default 0,
  add column if not exists locked_amount numeric(12, 2) not null default 0,
  add column if not exists refunded_amount numeric(12, 2) not null default 0,
  add column if not exists pricing_progress_at timestamptz null,
  add column if not exists checkout_snapshot_json jsonb not null default '{}'::jsonb,
  add column if not exists source_payment_intent_id uuid null;

create table if not exists payment_intent (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  user_id uuid not null references sys_user(id),
  target_device_id uuid null references device(id),
  session_id uuid null references runtime_session(id),
  order_id uuid null references irrigation_order(id),
  imei varchar(64) not null,
  payment_channel varchar(32) not null,
  payment_mode varchar(32) not null,
  status varchar(32) not null default 'created',
  out_trade_no varchar(64) not null,
  callback_token varchar(128) not null,
  amount numeric(12, 2) not null default 0,
  refunded_amount numeric(12, 2) not null default 0,
  pay_link text null,
  checkout_snapshot_json jsonb not null default '{}'::jsonb,
  provider_payload_json jsonb not null default '{}'::jsonb,
  paid_at timestamptz null,
  refunded_at timestamptz null,
  expired_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, out_trade_no)
);

create index if not exists ix_payment_intent_user
  on payment_intent (tenant_id, user_id, created_at desc);

create index if not exists ix_payment_intent_imei
  on payment_intent (tenant_id, imei, created_at desc);

create index if not exists ix_payment_intent_status
  on payment_intent (tenant_id, status, created_at desc);
