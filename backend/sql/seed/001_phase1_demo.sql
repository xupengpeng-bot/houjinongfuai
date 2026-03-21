insert into tenant (id, tenant_code, tenant_name, status)
values ('00000000-0000-0000-0000-000000000001', 'demo-tenant', 'Demo Tenant', 'active')
on conflict (id) do nothing;

insert into sys_user (id, tenant_id, user_type, display_name, mobile, status)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'farmer', 'Demo Farmer', '13800000001', 'active'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'project_manager', 'Demo Manager', '13800000002', 'active'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'farmer', 'Fallback Farmer', '13800000003', 'active')
on conflict (tenant_id, mobile) do nothing;

insert into region (id, tenant_id, parent_id, region_code, region_name, region_type, full_path, manager_user_id, status)
values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', null, 'project-demo', 'Demo Project', 'project', '/project-demo', '00000000-0000-0000-0000-000000000102', 'active'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', 'plot-demo', 'Demo Plot', 'plot', '/project-demo/plot-demo', '00000000-0000-0000-0000-000000000102', 'active')
on conflict (tenant_id, region_code) do nothing;

insert into device_type (id, tenant_id, type_code, type_name, family, capability_json, default_config_json, form_schema_json, status)
values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000001', 'well-type-demo', 'Well Type Demo', 'well', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000001', 'pump-type-demo', 'Pump Type Demo', 'pump', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000001', 'valve-type-demo', 'Valve Type Demo', 'valve', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000001', 'well-type-fallback', 'Well Type Fallback', 'well', '{}'::jsonb, '{"runtimeDefaults":{"idleTimeoutSeconds":120,"concurrencyLimit":1,"minRunSeconds":20}}'::jsonb, '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-000000000001', 'well-type-empty', 'Well Type Empty', 'well', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'active')
on conflict (tenant_id, type_code) do nothing;

insert into device (id, tenant_id, device_type_id, region_id, device_code, device_name, serial_no, protocol_type, online_state, lifecycle_state, runtime_state, ext_json)
values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', 'well-device-demo', 'Well Device Demo', 'SN-WELL-001', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', 'pump-device-demo', 'Pump Device Demo', 'SN-PUMP-001', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202', 'valve-device-demo', 'Valve Device Demo', 'SN-VALVE-001', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000404', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', 'well-device-offline', 'Well Device Offline', 'SN-WELL-002', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000405', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', 'pump-device-offline', 'Pump Device Offline', 'SN-PUMP-002', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000406', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202', 'valve-device-offline', 'Valve Device Offline', 'SN-VALVE-002', 'mock', 'offline', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000407', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000201', 'well-device-fallback', 'Well Device Fallback', 'SN-WELL-003', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000408', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', 'pump-device-fallback', 'Pump Device Fallback', 'SN-PUMP-003', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000409', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202', 'valve-device-fallback', 'Valve Device Fallback', 'SN-VALVE-003', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000410', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-000000000201', 'well-device-missing', 'Well Device Missing', 'SN-WELL-004', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', 'pump-device-missing', 'Pump Device Missing', 'SN-PUMP-004', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202', 'valve-device-missing', 'Valve Device Missing', 'SN-VALVE-004', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000413', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', 'well-device-free', 'Well Device Free', 'SN-WELL-005', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000414', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', 'pump-device-free', 'Pump Device Free', 'SN-PUMP-005', 'mock', 'online', 'active', 'idle', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000415', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202', 'valve-device-free', 'Valve Device Free', 'SN-VALVE-005', 'mock', 'online', 'active', 'idle', '{}'::jsonb)
on conflict (tenant_id, device_code) do nothing;

insert into well (id, tenant_id, device_id, well_code, water_source_type, rated_flow, rated_pressure, max_concurrency, safety_profile_json)
values
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000401', 'well-demo', 'groundwater', 20.0, 10.0, 2, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000404', 'well-offline', 'groundwater', 20.0, 10.0, 1, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000407', 'well-fallback', 'groundwater', 20.0, 10.0, 1, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000410', 'well-policy-missing', 'groundwater', 20.0, 10.0, 1, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000413', 'well-free', 'groundwater', 20.0, 10.0, 1, '{}'::jsonb)
on conflict (tenant_id, well_code) do nothing;

insert into pump (id, tenant_id, device_id, well_id, pump_code, rated_power_kw, startup_timeout_sec, stop_timeout_sec)
values
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000501', 'pump-demo', 5.5, 30, 30),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000405', '00000000-0000-0000-0000-000000000502', 'pump-offline', 5.5, 30, 30),
  ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000408', '00000000-0000-0000-0000-000000000503', 'pump-fallback', 5.5, 30, 30),
  ('00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000504', 'pump-policy-missing', 5.5, 30, 30),
  ('00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000414', '00000000-0000-0000-0000-000000000505', 'pump-free', 5.5, 30, 30)
on conflict (tenant_id, pump_code) do nothing;

insert into valve (id, tenant_id, device_id, well_id, valve_code, valve_kind, open_timeout_sec, close_timeout_sec, farmland_region_id)
values
  ('00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000501', 'valve-demo', 'electromagnetic', 15, 15, '00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000406', '00000000-0000-0000-0000-000000000502', 'valve-offline', 'electromagnetic', 15, 15, '00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000409', '00000000-0000-0000-0000-000000000503', 'valve-fallback', 'electromagnetic', 15, 15, '00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000504', 'valve-policy-missing', 'electromagnetic', 15, 15, '00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000705', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000415', '00000000-0000-0000-0000-000000000505', 'valve-free', 'electromagnetic', 15, 15, '00000000-0000-0000-0000-000000000202')
on conflict (tenant_id, valve_code) do nothing;

insert into billing_package (id, tenant_id, package_code, package_name, billing_mode, unit_price, unit_type, min_charge_amount, scope_type, scope_ref_id, status)
values
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000001', 'billing-duration', 'Billing Duration', 'duration', 1.80, 'minute', 1.80, 'well', '00000000-0000-0000-0000-000000000501', 'active'),
  ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000001', 'billing-flat', 'Billing Flat', 'flat', 12.00, 'session', 12.00, 'well', '00000000-0000-0000-0000-000000000503', 'active'),
  ('00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000001', 'billing-free', 'Billing Free', 'free', 0.00, 'session', 0.00, 'well', '00000000-0000-0000-0000-000000000505', 'active')
on conflict (tenant_id, package_code) do nothing;

insert into well_runtime_policy (id, tenant_id, well_id, billing_package_id, power_threshold_kw, min_run_seconds, max_run_seconds, concurrency_limit, stop_protection_mode, safety_rule_json, status)
values
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000801', 5.50, 0, 3600, 2, 'stop_pump_then_close_valve', '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000801', 5.50, 0, 3600, 1, 'stop_pump_then_close_valve', '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000803', 5.50, 0, 2400, 1, 'stop_pump_then_close_valve', '{}'::jsonb, 'active')
on conflict do nothing;

insert into interaction_policy (id, tenant_id, target_type, scene_code, confirm_mode, prompt_json, status)
values
  ('00000000-0000-0000-0000-000000001101', '00000000-0000-0000-0000-000000000001', 'valve', 'farmer_scan_start', 'single_confirm', '{"runtimeDefaults":{"maxRunSeconds":1200}}'::jsonb, 'active')
on conflict do nothing;

insert into scenario_template (id, tenant_id, template_code, template_name, target_family, template_config_json, status)
values
  ('00000000-0000-0000-0000-000000001201', '00000000-0000-0000-0000-000000000001', 'tmpl-fallback-flat', 'Fallback Flat Template', 'well', '{"runtimeDefaults":{"minRunSeconds":45,"stopProtectionMode":"close_valve_then_stop_pump"}}'::jsonb, 'active')
on conflict (tenant_id, template_code) do nothing;

insert into pump_valve_relation (id, tenant_id, well_id, pump_id, valve_id, relation_role, billing_inherit_mode, relation_config_json, status)
values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000701', 'primary', 'well_policy', '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000702', 'primary', 'well_policy', '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000703', 'primary', 'relation_override', '{"billingPackageId":"00000000-0000-0000-0000-000000000802","templateCode":"tmpl-fallback-flat"}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000704', 'primary', 'well_policy', '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0000-000000001005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000705', 'primary', 'well_policy', '{}'::jsonb, 'active')
on conflict (tenant_id, well_id, pump_id, valve_id) do nothing;
