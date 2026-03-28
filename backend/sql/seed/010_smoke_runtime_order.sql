insert into runtime_decision (
  id, tenant_id, user_id, scene_code, target_type, target_id, decision_result,
  blocking_reasons_json, available_actions_json, effective_rule_snapshot_json,
  price_preview_json, decision_expires_at, created_at
)
values
  (
    '00000000-0000-0000-0000-000000003001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    'S01_normal_start_stop',
    'well',
    '00000000-0000-0000-0000-000000000501',
    'allow',
    '[]'::jsonb,
    '[{"code":"START_SESSION","label":"Start Session","requiresConfirm":true}]'::jsonb,
    '{"scenarioCode":"S01","resolved_from":{"billing_package_source":"well_runtime_policy"}}'::jsonb,
    '{"billingMode":"duration","unitPrice":1.8,"unitType":"minute","currency":"CNY","minChargeAmount":1.8,"billingPackageId":"00000000-0000-0000-0000-000000000801"}'::jsonb,
    '2026-03-22 10:15:00+08',
    '2026-03-22 09:00:00+08'
  )
on conflict (id) do nothing;

insert into runtime_session (
  id, tenant_id, session_no, runtime_container_id, source_decision_id, user_id,
  well_id, pump_id, valve_id, status, billing_started_at, started_at, ended_at,
  end_reason_code, telemetry_snapshot_json, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000003101',
    '00000000-0000-0000-0000-000000000001',
    'ORD-S01-SESSION-001',
    '00000000-0000-0000-0000-000000002001',
    '00000000-0000-0000-0000-000000003001',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000501',
    '00000000-0000-0000-0000-000000000601',
    '00000000-0000-0000-0000-000000000701',
    'ended',
    '2026-03-22 09:00:00+08',
    '2026-03-22 09:00:00+08',
    '2026-03-22 09:30:00+08',
    'manual_stop',
    '{"scenarioCode":"S01","startedBy":"seed"}'::jsonb,
    '2026-03-22 09:00:00+08',
    '2026-03-22 09:30:00+08'
  )
on conflict (tenant_id, session_no) do nothing;

insert into session_status_log (
  id, tenant_id, session_id, from_status, to_status, action_code, reason_code,
  snapshot_json, reason_text, source, actor_id, created_at
)
values
  ('00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003101', 'created', 'running', 'create_session', 'DECISION_ALLOW', '{"scenarioCode":"S01"}'::jsonb, 'seed create running', 'runtime_engine', '00000000-0000-0000-0000-000000000101', '2026-03-22 09:00:00+08'),
  ('00000000-0000-0000-0000-000000003202', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003101', 'running', 'ended', 'stop_session_completed', 'MANUAL_STOP', '{"scenarioCode":"S01"}'::jsonb, 'seed manual stop', 'runtime_engine', '00000000-0000-0000-0000-000000000101', '2026-03-22 09:30:00+08'),
  ('00000000-0000-0000-0000-000000003203', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003101', 'ended', 'settled', 'settle_success', 'ORDER_SETTLED', '{"scenarioCode":"S01"}'::jsonb, 'seed settle complete', 'runtime_engine', '00000000-0000-0000-0000-000000000101', '2026-03-22 09:31:00+08')
on conflict (id) do nothing;

insert into irrigation_order (
  id, tenant_id, order_no, session_id, user_id, billing_package_id, status,
  settlement_status, charge_duration_sec, charge_volume, amount,
  pricing_snapshot_json, pricing_detail_json, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000003301',
    '00000000-0000-0000-0000-000000000001',
    'ORD-S01-001',
    '00000000-0000-0000-0000-000000003101',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000801',
    'settled',
    'paid',
    1800,
    18.50,
    54.00,
    '{"scenarioCode":"S01","mode":"duration","unitPrice":1.8,"unitType":"minute","minChargeAmount":1.8,"breakdown":[{"item":"duration_min","value":30},{"item":"amount","value":54}]}'::jsonb,
    '{"scenarioCode":"S01","billing_mode":"duration","unit_price":1.8,"unit":"m3","usage":{"volume":18.5},"duration_seconds":1800,"final_amount":54,"preview_final_amount":54,"preview_delta_amount":0}'::jsonb,
    '2026-03-22 09:31:00+08',
    '2026-03-22 09:31:00+08'
  )
on conflict (tenant_id, order_no) do nothing;

insert into command_dispatch (
  id, tenant_id, session_id, target_device_id, command_code, dispatch_status,
  request_payload_json, response_payload_json, sent_at, acked_at, created_at
)
values
  ('00000000-0000-0000-0000-000000003401', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003101', '00000000-0000-0000-0000-000000000421', 'open_valve', 'success', '{"scenarioCode":"S01"}'::jsonb, '{"ok":true}'::jsonb, '2026-03-22 09:00:05+08', '2026-03-22 09:00:06+08', '2026-03-22 09:00:05+08'),
  ('00000000-0000-0000-0000-000000003402', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003101', '00000000-0000-0000-0000-000000000411', 'start_pump', 'success', '{"scenarioCode":"S01"}'::jsonb, '{"ok":true}'::jsonb, '2026-03-22 09:00:10+08', '2026-03-22 09:00:11+08', '2026-03-22 09:00:10+08'),
  ('00000000-0000-0000-0000-000000003403', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003101', '00000000-0000-0000-0000-000000000411', 'stop_pump', 'success', '{"scenarioCode":"S01"}'::jsonb, '{"ok":true}'::jsonb, '2026-03-22 09:30:00+08', '2026-03-22 09:30:01+08', '2026-03-22 09:30:00+08')
on conflict (id) do nothing;
