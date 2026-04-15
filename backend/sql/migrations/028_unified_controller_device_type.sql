-- unified integrated controller device type baseline
-- Added on 2026-04-07 to support "one controller + multiple feature modules"

insert into device_type (
  id, tenant_id, type_code, type_name, family,
  capability_json, default_config_json, form_schema_json, status, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000315',
  '00000000-0000-0000-0000-000000000001',
  'TYPE-S08-H2-UNIFIED',
  'H2 Unified Controller',
  'controller',
  '{
    "protocol": "tcp-json-v1",
    "firmware_family": "FW_H2_UNIFIED",
    "supports_control": true,
    "supports_telemetry": true,
    "supports_location_report": false,
    "roles": ["primary_controller", "integrated_controller"],
    "feature_modules": [
      "pump_vfd_control",
      "pump_direct_control",
      "single_valve_control",
      "pressure_acquisition",
      "flow_acquisition",
      "level_acquisition",
      "soil_moisture_acquisition",
      "soil_temperature_acquisition",
      "power_monitoring",
      "rs485_sensor_gateway",
      "rs485_vfd_gateway",
      "valve_feedback_monitor",
      "pump_fault_feedback",
      "remote_start_enable",
      "auto_linkage_enable",
      "auto_stop_on_low_pressure",
      "auto_stop_on_high_pressure"
    ],
    "resource_inventory": {
      "relay_output": 2,
      "motor_driver": 2,
      "digital_input": 2,
      "analog_input": 2,
      "pulse_input": 1,
      "rs485_modbus": 1,
      "power_monitor": 1
    },
    "auto_identity_keys": ["imei", "hardware_sku", "firmware_family"],
    "remarks": "Unified integrated controller for point/controller/terminal-unit flow"
  }'::jsonb,
  '{
    "preferred_comm_identity_type": "imei",
    "bindingDefaults": {
      "scope": "node",
      "nodeTypes": ["source_station", "well", "pump", "outlet", "valve", "sensor"],
      "role": "primary_controller",
      "cardinality": "one_per_node",
      "priority": 120
    },
    "autoProfiles": {
      "source_station": {
        "feature_modules": ["pump_vfd_control", "pressure_acquisition", "flow_acquisition", "power_monitoring"]
      },
      "well": {
        "feature_modules": ["pump_vfd_control", "pressure_acquisition", "flow_acquisition", "power_monitoring"]
      },
      "pump": {
        "feature_modules": ["pump_vfd_control", "pressure_acquisition", "flow_acquisition", "power_monitoring"]
      },
      "outlet": {
        "feature_modules": ["single_valve_control", "valve_feedback_monitor", "flow_acquisition"]
      },
      "valve": {
        "feature_modules": ["single_valve_control", "valve_feedback_monitor"]
      },
      "sensor:soil": {
        "feature_modules": ["soil_moisture_acquisition", "soil_temperature_acquisition"]
      }
    },
    "channelTemplates": {
      "pump_vfd_control": [
        { "channel_code": "CH_RELAY_1", "channel_role": "vfd_run", "io_kind": "relay_output" }
      ],
      "pressure_acquisition": [
        { "channel_code": "CH_AI_1", "channel_role": "pressure_sensor", "io_kind": "analog_input" }
      ],
      "flow_acquisition": [
        { "channel_code": "CH_PULSE_1", "channel_role": "flow_sensor", "io_kind": "pulse_input" }
      ],
      "single_valve_control": [
        { "channel_code": "CH_RELAY_1", "channel_role": "valve_open", "io_kind": "relay_output" }
      ],
      "valve_feedback_monitor": [
        { "channel_code": "CH_DI_1", "channel_role": "valve_feedback", "io_kind": "digital_input" }
      ],
      "soil_moisture_acquisition": [
        { "channel_code": "CH_RS485_1", "channel_role": "soil_moisture_sensor", "io_kind": "rs485_modbus" }
      ],
      "soil_temperature_acquisition": [
        { "channel_code": "CH_RS485_1", "channel_role": "soil_temperature_sensor", "io_kind": "rs485_modbus" }
      ],
      "power_monitoring": [
        { "channel_code": "CH_PWR_1", "channel_role": "power_sensor", "io_kind": "power_monitor" }
      ]
    }
  }'::jsonb,
  '{
    "ui_mode": "controller_unified",
    "sections": [
      { "code": "identity", "title": "Identity", "fields": ["imei", "device_name"] },
      { "code": "modules", "title": "Feature Modules", "fields": ["feature_modules"] },
      { "code": "rules", "title": "Runtime Rules", "fields": ["runtime_rules"] }
    ]
  }'::jsonb,
  'active',
  '2026-04-07 12:00:00+08',
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
