insert into billing_package (id, tenant_id, package_code, package_name, billing_mode, unit_price, unit_type, min_charge_amount, scope_type, scope_ref_id, status, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000001', 'BILL-S01-DURATION', 'S01 Duration Package', 'duration', 1.80, 'minute', 1.80, 'well', '00000000-0000-0000-0000-000000000501', 'active', '2026-03-22 09:40:00+08', '2026-03-22 09:40:00+08'),
  ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000001', 'BILL-S08-VOLUME', 'S08 Volume Package', 'volume', 2.60, 'm3', 5.20, 'well', '00000000-0000-0000-0000-000000000507', 'active', '2026-03-22 09:40:00+08', '2026-03-22 09:40:00+08'),
  ('00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000001', 'BILL-S05-FREE', 'S05 Free Package', 'free', 0.00, 'session', 0.00, 'well', '00000000-0000-0000-0000-000000000505', 'active', '2026-03-22 09:40:00+08', '2026-03-22 09:40:00+08'),
  ('00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000001', 'BILL-S08-FLAT', 'S08 Flat Package', 'flat', 12.00, 'session', 12.00, 'well', '00000000-0000-0000-0000-000000000507', 'active', '2026-03-22 09:40:00+08', '2026-03-22 09:40:00+08')
on conflict (tenant_id, package_code) do nothing;

insert into interaction_policy (id, tenant_id, target_type, scene_code, confirm_mode, prompt_json, status, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000851', '00000000-0000-0000-0000-000000000001', 'well', 'farmer_scan_start', 'single_confirm', '{"runtimeDefaults":{"maxRunSeconds":120,"concurrencyLimit":2}}'::jsonb, 'active', '2026-03-22 09:41:00+08', '2026-03-22 09:41:00+08'),
  ('00000000-0000-0000-0000-000000000852', '00000000-0000-0000-0000-000000000001', 'valve', 'farmer_scan_start', 'single_confirm', '{"runtimeDefaults":{"maxRunSeconds":120,"concurrencyLimit":2}}'::jsonb, 'active', '2026-03-22 09:41:10+08', '2026-03-22 09:41:10+08')
on conflict (id) do nothing;

insert into scenario_template (id, tenant_id, template_code, template_name, target_family, template_config_json, status, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000861', '00000000-0000-0000-0000-000000000001', 'TPL-S08-BASELINE', 'S08 Baseline Template', 'well', '{"runtimeDefaults":{"minRunSeconds":45,"stopProtectionMode":"stop_pump_then_close_valve"}}'::jsonb, 'active', '2026-03-22 09:42:00+08', '2026-03-22 09:42:00+08')
on conflict (tenant_id, template_code) do nothing;

insert into well_runtime_policy (id, tenant_id, well_id, billing_package_id, power_threshold_kw, min_run_seconds, max_run_seconds, concurrency_limit, stop_protection_mode, safety_rule_json, status, effective_from, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000801', 5.50, 60, 3600, 1, 'stop_pump_then_close_valve', '{"scenarioCode":"S01"}'::jsonb, 'active', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08'),
  ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000801', 5.50, 60, 2400, 1, 'stop_pump_then_close_valve', '{"scenarioCode":"S02"}'::jsonb, 'active', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08'),
  ('00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000801', 5.20, 60, 1800, 1, 'stop_pump_then_close_valve', '{"scenarioCode":"S04"}'::jsonb, 'active', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08'),
  ('00000000-0000-0000-0000-000000000905', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000803', 4.50, 30, 3600, 1, 'stop_pump_then_close_valve', '{"scenarioCode":"S05"}'::jsonb, 'active', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08'),
  ('00000000-0000-0000-0000-000000000906', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000801', 7.50, 60, 5400, 1, 'stop_pump_then_close_valve', '{"scenarioCode":"S06"}'::jsonb, 'active', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08', '2026-03-22 09:45:00+08')
on conflict (id) do nothing;

insert into pump_valve_relation (id, tenant_id, well_id, pump_id, valve_id, relation_role, billing_inherit_mode, relation_config_json, status, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000701', 'primary', 'well_policy', '{"scenarioCode":"S01","sequence":"valve_first","valveDelaySeconds":3,"pumpDelaySeconds":5}'::jsonb, 'active', '2026-03-22 09:50:00+08', '2026-03-22 09:50:00+08'),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000702', 'primary', 'well_policy', '{"scenarioCode":"S02","sequence":"valve_first","valveDelaySeconds":3,"pumpDelaySeconds":5}'::jsonb, 'active', '2026-03-22 09:50:00+08', '2026-03-22 09:50:00+08'),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000703', 'primary', 'well_policy', '{"scenarioCode":"S03","sequence":"valve_first","valveDelaySeconds":3,"pumpDelaySeconds":5}'::jsonb, 'active', '2026-03-22 09:50:00+08', '2026-03-22 09:50:00+08'),
  ('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000704', 'primary', 'well_policy', '{"scenarioCode":"S04","sequence":"valve_first","valveDelaySeconds":3,"pumpDelaySeconds":5}'::jsonb, 'active', '2026-03-22 09:50:00+08', '2026-03-22 09:50:00+08'),
  ('00000000-0000-0000-0000-000000001005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000705', 'primary', 'well_policy', '{"scenarioCode":"S05","sequence":"valve_first","valveDelaySeconds":2,"pumpDelaySeconds":4}'::jsonb, 'active', '2026-03-22 09:50:00+08', '2026-03-22 09:50:00+08'),
  ('00000000-0000-0000-0000-000000001006', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000606', '00000000-0000-0000-0000-000000000706', 'primary', 'well_policy', '{"scenarioCode":"S06","sequence":"valve_first","valveDelaySeconds":2,"pumpDelaySeconds":4}'::jsonb, 'active', '2026-03-22 09:50:00+08', '2026-03-22 09:50:00+08'),
  ('00000000-0000-0000-0000-000000001007', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000607', '00000000-0000-0000-0000-000000000707', 'primary', 'well_policy', '{"scenarioCode":"S08","sequence":"simultaneous","valveDelaySeconds":0,"pumpDelaySeconds":0,"templateCode":"TPL-S08-BASELINE","billingPackageId":"00000000-0000-0000-0000-000000000804"}'::jsonb, 'active', '2026-03-22 09:50:00+08', '2026-03-22 09:50:00+08')
on conflict (tenant_id, well_id, pump_id, valve_id) do nothing;

insert into runtime_container (id, tenant_id, well_id, status, active_session_count, shared_resource_snapshot_json, protection_state_json, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', 'ready', 0, '{"scenarioCode":"S01"}'::jsonb, '{}'::jsonb, '2026-03-22 09:55:00+08', '2026-03-22 09:55:00+08'),
  ('00000000-0000-0000-0000-000000002006', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000506', 'running', 1, '{"scenarioCode":"S06"}'::jsonb, '{"lock":"active"}'::jsonb, '2026-03-22 09:55:00+08', '2026-03-22 11:10:00+08')
on conflict (id) do nothing;
