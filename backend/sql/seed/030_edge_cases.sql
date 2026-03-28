insert into runtime_decision (
  id, tenant_id, user_id, scene_code, target_type, target_id, decision_result,
  blocking_reasons_json, available_actions_json, effective_rule_snapshot_json,
  price_preview_json, decision_expires_at, created_at
)
values
  (
    '00000000-0000-0000-0000-000000003002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000105',
    'S02_insufficient_balance',
    'well',
    '00000000-0000-0000-0000-000000000502',
    'deny',
    '[{"code":"FORBIDDEN","message":"Insufficient balance for current session","source":"billing","reasonText":"Insufficient balance for current session"}]'::jsonb,
    '[{"code":"contact_support","label":"Contact Support","requiresConfirm":false}]'::jsonb,
    '{"scenarioCode":"S02","note":"current phase has no wallet model; this row is a deterministic deny artifact for UAT"}'::jsonb,
    'null'::jsonb,
    '2026-03-22 12:30:00+08',
    '2026-03-22 12:00:00+08'
  ),
  (
    '00000000-0000-0000-0000-000000003003',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    'S03_policy_missing',
    'well',
    '00000000-0000-0000-0000-000000000503',
    'deny',
    '[{"code":"POLICY_NOT_EFFECTIVE","message":"No effective runtime policy could be resolved from the fixed fallback chain","source":"policy","reasonText":"No effective runtime policy could be resolved"}]'::jsonb,
    '[{"code":"contact_support","label":"Contact Support","requiresConfirm":false}]'::jsonb,
    '{"scenarioCode":"S03"}'::jsonb,
    'null'::jsonb,
    '2026-03-22 12:30:00+08',
    '2026-03-22 12:01:00+08'
  ),
  (
    '00000000-0000-0000-0000-000000003004',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    'S04_topology_blocked',
    'well',
    '00000000-0000-0000-0000-000000000504',
    'deny',
    '[{"code":"DEVICE_OFFLINE","message":"Valve device is not active and online","source":"topology","reasonText":"Valve device is offline"}]'::jsonb,
    '[{"code":"retry_later","label":"Retry Later","requiresConfirm":false}]'::jsonb,
    '{"scenarioCode":"S04"}'::jsonb,
    'null'::jsonb,
    '2026-03-22 12:30:00+08',
    '2026-03-22 12:02:00+08'
  ),
  (
    '00000000-0000-0000-0000-000000003005',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000106',
    'S05_free_package',
    'well',
    '00000000-0000-0000-0000-000000000505',
    'allow',
    '[]'::jsonb,
    '[{"code":"START_SESSION","label":"Start Session","requiresConfirm":true}]'::jsonb,
    '{"scenarioCode":"S05"}'::jsonb,
    '{"billingMode":"free","unitPrice":0,"unitType":"session","currency":"CNY","minChargeAmount":0,"billingPackageId":"00000000-0000-0000-0000-000000000803"}'::jsonb,
    '2026-03-22 12:30:00+08',
    '2026-03-22 12:03:00+08'
  )
on conflict (id) do nothing;

insert into runtime_session (
  id, tenant_id, session_no, source_decision_id, user_id, well_id, pump_id, valve_id,
  status, billing_started_at, started_at, ended_at, end_reason_code, telemetry_snapshot_json, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000003105',
    '00000000-0000-0000-0000-000000000001',
    'SES-S05-001',
    '00000000-0000-0000-0000-000000003005',
    '00000000-0000-0000-0000-000000000106',
    '00000000-0000-0000-0000-000000000505',
    '00000000-0000-0000-0000-000000000605',
    '00000000-0000-0000-0000-000000000705',
    'ended',
    '2026-03-21 14:00:00+08',
    '2026-03-21 14:00:00+08',
    '2026-03-21 14:20:00+08',
    'manual_stop',
    '{"scenarioCode":"S05"}'::jsonb,
    '2026-03-21 14:00:00+08',
    '2026-03-21 14:20:00+08'
  ),
  (
    '00000000-0000-0000-0000-000000003107',
    '00000000-0000-0000-0000-000000000001',
    'SES-S07-REFUND-001',
    null,
    '00000000-0000-0000-0000-000000000105',
    '00000000-0000-0000-0000-000000000507',
    '00000000-0000-0000-0000-000000000607',
    '00000000-0000-0000-0000-000000000707',
    'ended',
    '2026-03-20 16:00:00+08',
    '2026-03-20 16:00:00+08',
    '2026-03-20 16:25:00+08',
    'manual_stop',
    '{"scenarioCode":"S07"}'::jsonb,
    '2026-03-20 16:00:00+08',
    '2026-03-20 16:25:00+08'
  )
on conflict (tenant_id, session_no) do nothing;

insert into irrigation_order (
  id, tenant_id, order_no, session_id, user_id, billing_package_id, status,
  settlement_status, charge_duration_sec, charge_volume, amount,
  pricing_snapshot_json, pricing_detail_json, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000003305',
    '00000000-0000-0000-0000-000000000001',
    'ORD-S05-001',
    '00000000-0000-0000-0000-000000003105',
    '00000000-0000-0000-0000-000000000106',
    '00000000-0000-0000-0000-000000000803',
    'settled',
    'paid',
    1200,
    9.80,
    0.00,
    '{"scenarioCode":"S05","mode":"free","unitPrice":0,"unitType":"session"}'::jsonb,
    '{"scenarioCode":"S05","billing_mode":"free","unit_price":0,"unit":"m3","usage":{"volume":9.8},"duration_seconds":1200,"final_amount":0,"preview_final_amount":0,"preview_delta_amount":0}'::jsonb,
    '2026-03-21 14:21:00+08',
    '2026-03-21 14:21:00+08'
  ),
  (
    '00000000-0000-0000-0000-000000003307',
    '00000000-0000-0000-0000-000000000001',
    'ORD-S07-REFUND-001',
    '00000000-0000-0000-0000-000000003107',
    '00000000-0000-0000-0000-000000000105',
    '00000000-0000-0000-0000-000000000802',
    'settled',
    'refunded',
    1500,
    10.00,
    26.00,
    '{"scenarioCode":"S07","mode":"volume","unitPrice":2.6,"unitType":"m3"}'::jsonb,
    '{"scenarioCode":"S07","billing_mode":"volume","unit_price":2.6,"unit":"m3","usage":{"volume":10.0},"duration_seconds":1500,"final_amount":26,"preview_final_amount":26,"preview_delta_amount":0,"refund":"manual"}'::jsonb,
    '2026-03-20 16:26:00+08',
    '2026-03-20 18:00:00+08'
  )
on conflict (tenant_id, order_no) do nothing;

insert into work_order (
  id, tenant_id, work_order_no, source_alarm_id, source_session_id, device_id,
  work_order_type, status, assignee_user_id, sla_deadline_at, result_json, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000003604', '00000000-0000-0000-0000-000000000001', 'WO-S07-004', '00000000-0000-0000-0000-000000003503', null, '00000000-0000-0000-0000-000000000427', 'inspection', 'completed', '00000000-0000-0000-0000-000000000103', '2026-03-22 10:00:00+08', '{"scenarioCode":"S07","title":"S07 completed inspection loop","priority":"low"}'::jsonb, '2026-03-22 09:30:00+08', '2026-03-22 10:00:00+08'),
  ('00000000-0000-0000-0000-000000003605', '00000000-0000-0000-0000-000000000001', 'WO-S07-005', null, '00000000-0000-0000-0000-000000003107', '00000000-0000-0000-0000-000000000417', 'review', 'closed', '00000000-0000-0000-0000-000000000102', '2026-03-21 20:00:00+08', '{"scenarioCode":"S07","title":"S07 closed review order","priority":"medium"}'::jsonb, '2026-03-20 18:10:00+08', '2026-03-21 20:00:00+08')
on conflict (tenant_id, work_order_no) do nothing;

insert into work_order_action_log (
  id, tenant_id, work_order_id, action_code, from_status, to_status, operator_id, remark, attachment_json, created_at
)
values
  ('00000000-0000-0000-0000-000000003613', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003604', 'complete', 'in_progress', 'completed', '00000000-0000-0000-0000-000000000103', 'S07 completed handling', '[]'::jsonb, '2026-03-22 10:00:00+08'),
  ('00000000-0000-0000-0000-000000003614', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000003605', 'close', 'completed', 'closed', '00000000-0000-0000-0000-000000000102', 'S07 admin closed review order', '[]'::jsonb, '2026-03-21 20:00:00+08')
on conflict (id) do nothing;
