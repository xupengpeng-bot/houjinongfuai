-- 047_investor_relations_v1.sql
-- COD-2026-04-14-IR-001: additive backend foundation for investor mobile V1.
-- Scope: project disclosure room, investor contact capture, offline intention follow-up.
-- Excludes formal subscription, settlement, dividends, withdrawals, and holdings.

create table if not exists investor_contact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  source_channel varchar(32) not null default 'investor_mobile',
  source_session_key varchar(128) null,
  contact_name varchar(64) not null,
  contact_phone varchar(32) not null,
  organization_name varchar(128) null,
  position_title varchar(64) null,
  city_name varchar(64) null,
  wechat_no varchar(64) null,
  investor_type varchar(24) not null default 'individual',
  risk_preference varchar(24) null,
  status varchar(24) not null default 'active',
  remarks text null,
  profile_json jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table investor_contact is 'Investor-side contact captured from investor mobile or IR handoff; not a formal subscription account.';
comment on column investor_contact.source_session_key is 'Anonymous/local session correlation key from investor mobile before any formal account binding.';

create index if not exists ix_investor_contact_phone
  on investor_contact (tenant_id, contact_phone, created_at desc);

create index if not exists ix_investor_contact_source_session
  on investor_contact (tenant_id, source_session_key);

create index if not exists ix_investor_contact_org
  on investor_contact (tenant_id, organization_name);

create table if not exists investor_project_interest (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  contact_id uuid not null references investor_contact(id),
  project_id uuid not null references project(id),
  project_block_id uuid null references project_block(id) on delete set null,
  source_channel varchar(32) not null default 'investor_mobile',
  intent_type varchar(24) not null default 'callback',
  intent_amount numeric(18, 2) null,
  currency_code varchar(8) not null default 'CNY',
  planned_decision_window varchar(32) null,
  lifecycle_status varchar(24) not null default 'submitted',
  followup_priority integer not null default 0,
  advisor_owner varchar(64) null,
  last_followup_at timestamptz null,
  next_followup_at timestamptz null,
  latest_reason_code varchar(64) null,
  intent_note text null,
  intake_snapshot_json jsonb not null default '{}'::jsonb,
  latest_progress_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table investor_project_interest is 'Investor mobile V1 intention record for offline follow-up; does not represent a legally effective subscription order.';
comment on column investor_project_interest.project_block_id is 'Optional block-level attribution when investor interest points to a specific block under a project.';

create index if not exists ix_investor_project_interest_contact
  on investor_project_interest (tenant_id, contact_id, created_at desc);

create index if not exists ix_investor_project_interest_project
  on investor_project_interest (tenant_id, project_id, lifecycle_status, created_at desc);

create index if not exists ix_investor_project_interest_next_followup
  on investor_project_interest (tenant_id, lifecycle_status, next_followup_at);

create table if not exists investor_project_interest_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  interest_id uuid not null references investor_project_interest(id) on delete cascade,
  from_status varchar(24) null,
  to_status varchar(24) not null,
  action_code varchar(32) not null,
  operator_type varchar(16) not null default 'system',
  operator_ref varchar(128) null,
  reason_code varchar(64) null,
  event_note text null,
  snapshot_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table investor_project_interest_event is 'Immutable lifecycle and follow-up audit trail for investor_project_interest.';

create index if not exists ix_investor_project_interest_event_interest
  on investor_project_interest_event (interest_id, occurred_at desc);

create index if not exists ix_investor_project_interest_event_tenant_status
  on investor_project_interest_event (tenant_id, to_status, occurred_at desc);

create table if not exists investor_material_access_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  contact_id uuid null references investor_contact(id) on delete set null,
  interest_id uuid null references investor_project_interest(id) on delete set null,
  project_id uuid not null references project(id),
  project_block_id uuid null references project_block(id) on delete set null,
  material_type varchar(32) not null,
  material_key varchar(128) not null,
  access_action varchar(24) not null default 'view',
  access_source varchar(32) not null default 'investor_mobile',
  access_snapshot_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table investor_material_access_log is 'Disclosure-room access trace for investor materials such as reports, plans, photos, videos, and risk notes.';

create index if not exists ix_investor_material_access_log_project
  on investor_material_access_log (tenant_id, project_id, occurred_at desc);

create index if not exists ix_investor_material_access_log_contact
  on investor_material_access_log (tenant_id, contact_id, occurred_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_investor_project_interest_lifecycle'
  ) then
    alter table investor_project_interest
      add constraint chk_investor_project_interest_lifecycle
      check (
        lifecycle_status in (
          'submitted',
          'contacted',
          'materials_shared',
          'meeting_scheduled',
          'watchlist',
          'converted_offline',
          'closed_lost',
          'archived'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_investor_project_interest_intent_type'
  ) then
    alter table investor_project_interest
      add constraint chk_investor_project_interest_intent_type
      check (
        intent_type in ('callback', 'visit', 'materials_only', 'strategic_partnership')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_investor_project_interest_event_operator'
  ) then
    alter table investor_project_interest_event
      add constraint chk_investor_project_interest_event_operator
      check (operator_type in ('investor', 'advisor', 'ops', 'system'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_investor_material_access_log_action'
  ) then
    alter table investor_material_access_log
      add constraint chk_investor_material_access_log_action
      check (access_action in ('view', 'download', 'share_link'));
  end if;
end $$;
