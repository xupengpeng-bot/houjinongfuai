alter table if exists farmer_card_portal_user
  alter column mobile drop not null;

alter table if exists farmer_card_portal_user
  add column if not exists auth_identity_json jsonb not null default '{}'::jsonb;
