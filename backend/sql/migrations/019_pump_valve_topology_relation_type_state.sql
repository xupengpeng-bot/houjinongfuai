-- COD-2026-03-27-035 — additive `topology_relation_type_state` on `pump_valve_relation`
-- for V1 topology relation vocabulary (manual / reported / effective) + solver read model.
-- Does not alter runtime_session / irrigation_order semantics.

ALTER TABLE pump_valve_relation
  ADD COLUMN IF NOT EXISTS topology_relation_type_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pump_valve_relation.topology_relation_type_state IS
  'JSON keys: manual, reported, effective — values must be topology_relation V1 enum (control|linkage|interlock|master_slave|gateway_access|sequence_delayed). If effective is omitted, API resolves effective := coalesce(effective, manual, reported, sequence_delayed).';
