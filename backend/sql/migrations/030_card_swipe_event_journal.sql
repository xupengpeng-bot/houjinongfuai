-- 030_card_swipe_event_journal.sql
-- Device-originated card swipe journal for idempotency and audit.

CREATE TABLE IF NOT EXISTS card_swipe_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES sys_user(id),
  imei varchar(64) NOT NULL,
  card_token varchar(64) NOT NULL,
  swipe_action varchar(16) NOT NULL,
  swipe_event_id varchar(128) NOT NULL,
  swipe_at timestamptz NULL,
  request_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, swipe_event_id)
);

CREATE INDEX IF NOT EXISTS ix_card_swipe_event_user_created
  ON card_swipe_event (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_card_swipe_event_imei_created
  ON card_swipe_event (tenant_id, imei, created_at DESC);
