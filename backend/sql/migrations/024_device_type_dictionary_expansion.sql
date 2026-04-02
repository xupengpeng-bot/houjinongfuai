-- network-workbench / irrigation device type dictionary expansion
-- Added on 2026-04-01 to support richer default binding rules for DXF-based network initialization.

insert into device_type (
  id, tenant_id, type_code, type_name, family,
  capability_json, default_config_json, form_schema_json, status, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-WELL',
    'Well Controller',
    'well',
    '{"protocol":"modbus","metrics":["pressure","flow","runtime"],"roles":["primary_controller","well_head_control"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node","nodeTypes":["well"],"assetTypes":["well"],"role":"primary_controller","cardinality":"one_per_node","priority":100}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-03-22 08:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000302',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-PUMP',
    'Pump Controller',
    'pump',
    '{"protocol":"modbus","metrics":["power","current","temperature","runtime"],"roles":["pump_control","pump_unit_control"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node_or_unit","nodeTypes":["well","pump"],"assetTypes":["pump","pump_station"],"role":"pump_controller","cardinality":"one_per_pump_unit","priority":100}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-03-22 08:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000303',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-VALVE',
    'Valve Controller',
    'valve',
    '{"protocol":"modbus","metrics":["position","open_count","close_count"],"roles":["valve_control","solenoid_control"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node","nodeTypes":["valve","outlet"],"assetTypes":["valve_group","control_zone"],"role":"primary_controller","cardinality":"one_per_node","priority":100}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-03-22 08:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000304',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-METER',
    'Water Meter Collector',
    'sensor',
    '{"protocol":"modbus","metrics":["volume","flow_rate","totalizer"],"roles":["metering","telemetry"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node","nodeTypes":["well","pump","outlet"],"assetTypes":["well","pump_station","control_zone"],"role":"telemetry","cardinality":"one_per_node","priority":80}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-03-22 08:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000305',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-PRESSURE',
    'Pressure Sensor Collector',
    'sensor',
    '{"protocol":"modbus","metrics":["pressure","instant_pressure"],"roles":["pressure_telemetry"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node","nodeTypes":["pump","outlet","sensor"],"assetTypes":["pump_station","control_zone","weather_point"],"role":"telemetry","cardinality":"one_per_node","priority":70}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000306',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-FLOW',
    'Flow Meter Collector',
    'sensor',
    '{"protocol":"modbus","metrics":["flow_rate","instant_flow","totalizer"],"roles":["flow_telemetry"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node","nodeTypes":["outlet","sensor"],"assetTypes":["control_zone","weather_point"],"role":"telemetry","cardinality":"one_per_node","priority":75}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000307',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-LEVEL',
    'Level Sensor Collector',
    'sensor',
    '{"protocol":"modbus","metrics":["level","liquid_level"],"roles":["level_telemetry"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node","nodeTypes":["sensor"],"assetTypes":["weather_point"],"role":"telemetry","cardinality":"one_per_node","priority":70}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000308',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-WEATHER',
    'Weather Station Collector',
    'sensor',
    '{"protocol":"modbus","metrics":["wind_speed","rainfall","temperature","humidity"],"roles":["weather_telemetry"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node","nodeTypes":["sensor"],"assetTypes":["weather_point"],"role":"telemetry","cardinality":"one_per_node","priority":70}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000309',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-GATEWAY',
    'IoT Gateway',
    'gateway',
    '{"protocol":"tcp-json-v1","metrics":["heartbeat","network_rssi"],"roles":["uplink","gateway"]}'::jsonb,
    '{"bindingDefaults":{"scope":"shared","nodeTypes":["well","pump","outlet","valve","sensor"],"assetTypes":["pump_station","well","control_zone"],"role":"shared_gateway","cardinality":"shared_per_block","priority":40}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000310',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-PLC',
    'PLC / RTU Controller',
    'control',
    '{"protocol":"modbus","metrics":["run_state","fault_code"],"roles":["station_control","logic_control"]}'::jsonb,
    '{"bindingDefaults":{"scope":"shared","nodeTypes":["pump","outlet"],"assetTypes":["pump_station","control_zone"],"role":"station_controller","cardinality":"shared_per_station","priority":60}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000311',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-POWER',
    'Power Meter Collector',
    'power',
    '{"protocol":"modbus","metrics":["voltage","current","energy_kwh"],"roles":["power_telemetry"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node_or_station","nodeTypes":["pump"],"assetTypes":["pump_station"],"role":"power_telemetry","cardinality":"one_per_node","priority":65}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000312',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-TRANSFORMER',
    'Transformer Monitor',
    'power',
    '{"protocol":"modbus","metrics":["load","temperature","trip_state"],"roles":["transformer_monitor"]}'::jsonb,
    '{"bindingDefaults":{"scope":"shared","nodeTypes":["pump"],"assetTypes":["pump_station"],"role":"power_monitor","cardinality":"shared_per_station","priority":55}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000313',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-VFD',
    'VFD Controller',
    'drive',
    '{"protocol":"modbus","metrics":["frequency","current","fault_code"],"roles":["drive_control","variable_frequency"]}'::jsonb,
    '{"bindingDefaults":{"scope":"node_or_unit","nodeTypes":["well","pump"],"assetTypes":["pump","pump_station"],"role":"pump_drive","cardinality":"one_per_pump_unit","priority":75}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000314',
    '00000000-0000-0000-0000-000000000001',
    'TYPE-S08-REMOTEIO',
    'Remote IO Controller',
    'io',
    '{"protocol":"modbus","metrics":["di","do","ai","ao"],"roles":["remote_io","field_expansion"]}'::jsonb,
    '{"bindingDefaults":{"scope":"shared","nodeTypes":["pump","outlet","valve"],"assetTypes":["pump_station","control_zone","valve_group"],"role":"field_io","cardinality":"shared_per_station","priority":50}}'::jsonb,
    '{}'::jsonb,
    'active',
    '2026-04-01 17:30:00+08',
    now()
  )
on conflict (tenant_id, type_code) do update
set
  type_name = excluded.type_name,
  family = excluded.family,
  capability_json = excluded.capability_json,
  default_config_json = excluded.default_config_json,
  form_schema_json = excluded.form_schema_json,
  status = excluded.status,
  updated_at = now();
