ALTER TABLE irrigation_order
ADD COLUMN IF NOT EXISTS pricing_detail_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE session_status_log
ADD COLUMN IF NOT EXISTS reason_text text;

ALTER TABLE session_status_log
ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'system';

ALTER TABLE session_status_log
ADD COLUMN IF NOT EXISTS actor_id uuid NULL REFERENCES sys_user(id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_runtime_session_source_decision_not_null
ON runtime_session (source_decision_id)
WHERE source_decision_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_irrigation_order_session_id
ON irrigation_order (session_id);
