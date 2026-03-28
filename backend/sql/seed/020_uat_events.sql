insert into runtime_decision (
  id, tenant_id, user_id, scene_code, target_type, target_id, decision_result,
  blocking_reasons_json, available_actions_json, effective_rule_snapshot_json,
  price_preview_json, decision_expires_at, created_at
)
values
  (
    '00000000-0000-0000-0000-000000003006',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000104',
    'S06_active_session_order',
    'well',
    '00000000-0000-0000-0000-000000000506',
    'allow',
    '[]'::jsonb,
    '[{"code":"START_SESSION","label":"Start Session","requiresConfirm":true}]'::jsonb,
    '{"scenarioCode":"S06","resolved_from":{"billing_package_source":"well_runtime_policy"}}'::jsonb,
    '{"billingMode":"duration","unitPrice":1.8,"unitType":"minute","currency":"CNY","minChargeAmount":1.8,"billingPackageId":"00000000-0000-0000-0000-000000000801"}'::jsonb,
    '2026-03-22 12:10:00+08',
    '2026-03-22 11:10:00+08'
  )
on conflict (id) do nothing;

insert into runtime_session (
  id, tenant_id, session_no, runtime_container_id, source_decision_id, user_id,
  well_id, pump_id, valve_id, status, billing_started_at, started_at,
  telemetry_snapshot_json, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000003106',
    '00000000-0000-0000-0000-000000000001',
    'SES-S06-001',
    '00000000-0000-0000-0000-000000002006',
    '00000000-0000-0000-0000-000000003006',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000506',
    '00000000-0000-0000-0000-000000000606',
    '00000000-0000-0000-0000-000000000706',
    'running',
    '2026-03-22 11:10:00+08',
    '2026-03-22 11:10:00+08',
    '{"scenarioCode":"S06","startedBy":"seed"}'::jsonb,
    '2026-03-22 11:10:00+08',
    '2026-03-22 11:20:00+08'
  )
on conflict (tenant_id, session_no) do nothing;

insert into session_status_log (
  id, tenant_id, session_id, from_status, to_status, action_code, reason_code,
  snapshot_json, reason_text, source, actor_id, created_at
)
values
  ('00000000-0000-0000-0000-000000003206', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003106', 'created', 'running', 'create_session', 'DECISION_ALLOW', '{"scenarioCode":"S06"}'::jsonb, 'seed active session', 'runtime_engine', '00000000-0000-0000-0000-000000000104', '2026-03-22 11:10:00+08')
on conflict (id) do nothing;

insert into irrigation_order (
  id, tenant_id, order_no, session_id, user_id, billing_package_id, status,
  settlement_status, charge_duration_sec, charge_volume, amount,
  pricing_snapshot_json, pricing_detail_json, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000003306',
    '00000000-0000-0000-0000-000000000001',
    'ORD-S06-001',
    '00000000-0000-0000-0000-000000003106',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000801',
    'created',
    'unpaid',
    600,
    6.20,
    0.00,
    '{"scenarioCode":"S06","mode":"duration","unitPrice":1.8,"unitType":"minute","minChargeAmount":1.8}'::jsonb,
    '{"scenarioCode":"S06","billing_mode":"duration","unit_price":1.8,"unit":"m3","usage":{"volume":6.2},"duration_seconds":600,"final_amount":0,"preview_final_amount":18}'::jsonb,
    '2026-03-22 11:11:00+08',
    '2026-03-22 11:20:00+08'
  )
on conflict (tenant_id, order_no) do nothing;

insert into command_dispatch (
  id, tenant_id, session_id, target_device_id, command_code, dispatch_status,
  request_payload_json, response_payload_json, sent_at, acked_at, created_at
)
values
  ('00000000-0000-0000-0000-000000003406', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003106', '00000000-0000-0000-0000-000000000426', 'open_valve', 'success', '{"scenarioCode":"S06"}'::jsonb, '{"ok":true}'::jsonb, '2026-03-22 11:10:02+08', '2026-03-22 11:10:03+08', '2026-03-22 11:10:02+08'),
  ('00000000-0000-0000-0000-000000003407', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003106', '00000000-0000-0000-0000-000000000416', 'start_pump', 'success', '{"scenarioCode":"S06"}'::jsonb, '{"ok":true}'::jsonb, '2026-03-22 11:10:05+08', '2026-03-22 11:10:06+08', '2026-03-22 11:10:05+08')
on conflict (id) do nothing;

insert into alarm_event (
  id, tenant_id, alarm_code, source_type, source_id, device_id, session_id,
  severity, status, trigger_reason_json, auto_create_work_order, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000003501', '00000000-0000-0000-0000-000000000001', 'ALM-S07-001', 'device', '00000000-0000-0000-0000-000000000416', '00000000-0000-0000-0000-000000000416', '00000000-0000-0000-0000-000000003106', 'medium', 'pending', '{"scenarioCode":"S07","message":"S06 pump current fluctuation needs inspection"}'::jsonb, true, '2026-03-22 11:15:00+08', '2026-03-22 11:15:00+08'),
  ('00000000-0000-0000-0000-000000003502', '00000000-0000-0000-0000-000000000001', 'ALM-S07-002', 'device', '00000000-0000-0000-0000-000000000424', '00000000-0000-0000-0000-000000000424', null, 'high', 'processing', '{"scenarioCode":"S07","message":"S04 valve offline is being processed"}'::jsonb, true, '2026-03-22 10:30:00+08', '2026-03-22 11:00:00+08'),
  ('00000000-0000-0000-0000-000000003503', '00000000-0000-0000-0000-000000000001', 'ALM-S07-003', 'device', '00000000-0000-0000-0000-000000000427', '00000000-0000-0000-0000-000000000427', null, 'low', 'resolved', '{"scenarioCode":"S07","message":"S08 water meter jitter recovered"}'::jsonb, false, '2026-03-22 09:20:00+08', '2026-03-22 09:40:00+08')
on conflict (id) do nothing;

insert into work_order (
  id, tenant_id, work_order_no, source_alarm_id, source_session_id, device_id,
  work_order_type, status, assignee_user_id, sla_deadline_at, result_json, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000003601', '00000000-0000-0000-0000-000000000001', 'WO-S07-001', '00000000-0000-0000-0000-000000003501', '00000000-0000-0000-0000-000000003106', '00000000-0000-0000-0000-000000000416', 'inspection', 'created', '00000000-0000-0000-0000-000000000107', '2026-03-22 13:00:00+08', '{"scenarioCode":"S07","title":"S07 onsite pump inspection","priority":"medium"}'::jsonb, '2026-03-22 11:16:00+08', '2026-03-22 11:16:00+08'),
  ('00000000-0000-0000-0000-000000003602', '00000000-0000-0000-0000-000000000001', 'WO-S07-002', '00000000-0000-0000-0000-000000003502', null, '00000000-0000-0000-0000-000000000424', 'repair', 'assigned', '00000000-0000-0000-0000-000000000103', '2026-03-22 14:00:00+08', '{"scenarioCode":"S07","title":"S07 valve offline repair","priority":"high"}'::jsonb, '2026-03-22 10:35:00+08', '2026-03-22 11:00:00+08'),
  ('00000000-0000-0000-0000-000000003603', '00000000-0000-0000-0000-000000000001', 'WO-S07-003', null, '00000000-0000-0000-0000-000000003106', '00000000-0000-0000-0000-000000000416', 'inspection', 'in_progress', '00000000-0000-0000-0000-000000000107', '2026-03-22 15:00:00+08', '{"scenarioCode":"S07","title":"S07 running session follow-up","priority":"high"}'::jsonb, '2026-03-22 11:25:00+08', '2026-03-22 11:40:00+08')
on conflict (tenant_id, work_order_no) do nothing;

insert into work_order_action_log (
  id, tenant_id, work_order_id, action_code, from_status, to_status, operator_id, remark, attachment_json, created_at
)
values
  ('00000000-0000-0000-0000-000000003611', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003602', 'assign', 'created', 'assigned', '00000000-0000-0000-0000-000000000102', 'S07 assigned to field operator', '[]'::jsonb, '2026-03-22 10:40:00+08'),
  ('00000000-0000-0000-0000-000000003612', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003603', 'process', 'assigned', 'in_progress', '00000000-0000-0000-0000-000000000107', 'S07 operator arrived onsite', '[]'::jsonb, '2026-03-22 11:40:00+08')
on conflict (id) do nothing;

insert into uat_case (
  id, tenant_id, case_code, role_type, scenario_name, expected_result, status, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000000001', 'UAT-RUNTIME-S01', 'farmer', 'Scan allow and complete order', 'S01 should allow start and create a settled order after stop', 'active', '2026-03-22 12:00:00+08', '2026-03-22 12:00:00+08'),
  ('00000000-0000-0000-0000-000000003702', '00000000-0000-0000-0000-000000000001', 'UAT-RUNTIME-S03', 'farmer', 'Policy missing blocking', 'S03 should return a policy blocking reason', 'active', '2026-03-22 12:01:00+08', '2026-03-22 12:01:00+08'),
  ('00000000-0000-0000-0000-000000003703', '00000000-0000-0000-0000-000000000001', 'UAT-ORDER-S06', 'admin', 'Orders page shows running order', 'S06 should show one active order', 'active', '2026-03-22 12:02:00+08', '2026-03-22 12:02:00+08'),
  ('00000000-0000-0000-0000-000000003704', '00000000-0000-0000-0000-000000000001', 'UAT-ALERT-S07', 'operator', 'Alerts page shows three statuses', 'S07 should show pending, processing, and resolved alerts', 'active', '2026-03-22 12:03:00+08', '2026-03-22 12:03:00+08'),
  ('00000000-0000-0000-0000-000000003705', '00000000-0000-0000-0000-000000000001', 'UAT-WORK_ORDER-S07', 'operator', 'Work order flow is visible', 'S07 should show created, assigned, and in_progress work orders', 'active', '2026-03-22 12:04:00+08', '2026-03-22 12:04:00+08'),
  ('00000000-0000-0000-0000-000000003706', '00000000-0000-0000-0000-000000000001', 'UAT-USER-S08', 'admin', 'Users page shows role baseline', 'S08 should show admin, operator, and farmer users', 'active', '2026-03-22 12:05:00+08', '2026-03-22 12:05:00+08')
on conflict (tenant_id, case_code) do nothing;

insert into uat_execution (
  id, tenant_id, execution_no, case_id, executor_user_id, status,
  block_reason_json, evidence_json, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-000000000001', 'UATEX-S01-001', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000000101', 'passed', '{}'::jsonb, '["open scan page","enter WELL-S01-001","allow returned","start session","stop session"]'::jsonb, '2026-03-22 12:10:00+08', '2026-03-22 12:10:00+08'),
  ('00000000-0000-0000-0000-000000003802', '00000000-0000-0000-0000-000000000001', 'UATEX-S03-001', '00000000-0000-0000-0000-000000003702', '00000000-0000-0000-0000-000000000101', 'passed', '{}'::jsonb, '["open scan page","enter WELL-S03-001","deny returned","check blocking reason"]'::jsonb, '2026-03-22 12:11:00+08', '2026-03-22 12:11:00+08'),
  ('00000000-0000-0000-0000-000000003803', '00000000-0000-0000-0000-000000000001', 'UATEX-S06-001', '00000000-0000-0000-0000-000000003703', '00000000-0000-0000-0000-000000000102', 'passed', '{}'::jsonb, '["open orders","see active order","verify amount is 0 before settle"]'::jsonb, '2026-03-22 12:12:00+08', '2026-03-22 12:12:00+08'),
  ('00000000-0000-0000-0000-000000003804', '00000000-0000-0000-0000-000000000001', 'UATEX-S07-001', '00000000-0000-0000-0000-000000003704', '00000000-0000-0000-0000-000000000103', 'passed', '{}'::jsonb, '["open alerts","see pending","see processing","see resolved"]'::jsonb, '2026-03-22 12:13:00+08', '2026-03-22 12:13:00+08'),
  ('00000000-0000-0000-0000-000000003805', '00000000-0000-0000-0000-000000000001', 'UATEX-S07-002', '00000000-0000-0000-0000-000000003705', '00000000-0000-0000-0000-000000000107', 'blocked', '{"scenarioCode":"S07","reason":"waiting for onsite pictures"}'::jsonb, '["open work orders","verify statuses"]'::jsonb, '2026-03-22 12:14:00+08', '2026-03-22 12:14:00+08'),
  ('00000000-0000-0000-0000-000000003806', '00000000-0000-0000-0000-000000000001', 'UATEX-S08-001', '00000000-0000-0000-0000-000000003706', '00000000-0000-0000-0000-000000000102', 'passed', '{}'::jsonb, '["open users","verify admin/operator/farmer"]'::jsonb, '2026-03-22 12:15:00+08', '2026-03-22 12:15:00+08')
on conflict (tenant_id, execution_no) do nothing;

insert into audit_log (
  id, tenant_id, actor_user_id, module_code, resource_type, resource_id,
  action_code, before_json, after_json, created_at
)
values
  ('00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'runtime', 'runtime_session', '00000000-0000-0000-0000-000000003106', 'view', '{}'::jsonb, '{"scenarioCode":"S06"}'::jsonb, '2026-03-22 11:30:00+08'),
  ('00000000-0000-0000-0000-000000003902', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'alarm', 'alarm_event', '00000000-0000-0000-0000-000000003501', 'acknowledge', '{}'::jsonb, '{"status":"processing","scenarioCode":"S07"}'::jsonb, '2026-03-22 11:45:00+08'),
  ('00000000-0000-0000-0000-000000003903', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000107', 'work_order', 'work_order', '00000000-0000-0000-0000-000000003603', 'process', '{}'::jsonb, '{"status":"in_progress","scenarioCode":"S07"}'::jsonb, '2026-03-22 11:46:00+08'),
  ('00000000-0000-0000-0000-000000003904', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'iam', 'sys_user', '00000000-0000-0000-0000-000000000103', 'assign_role', '{}'::jsonb, '{"role":"operator","scenarioCode":"S08"}'::jsonb, '2026-03-22 11:47:00+08')
on conflict (id) do nothing;

insert into operation_log (
  id, tenant_id, trace_id, module_code, level, message, extra_json, created_at
)
values
  ('00000000-0000-0000-0000-000000003951', '00000000-0000-0000-0000-000000000001', 'TRACE-S06-001', 'runtime', 'info', 'S06 active session heartbeat', '{"scenarioCode":"S06"}'::jsonb, '2026-03-22 11:20:00+08'),
  ('00000000-0000-0000-0000-000000003952', '00000000-0000-0000-0000-000000000001', 'TRACE-S07-001', 'alarm', 'warn', 'S07 alarm escalated to operator queue', '{"scenarioCode":"S07"}'::jsonb, '2026-03-22 11:15:00+08')
on conflict (id) do nothing;
