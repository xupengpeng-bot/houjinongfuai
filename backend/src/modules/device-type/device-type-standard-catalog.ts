export interface StandardDeviceTypeTemplate {
  type_code: string;
  type_name: string;
  device_category: string;
  preferred_comm_identity_type: string;
  supports_control: boolean;
  supports_telemetry: boolean;
  supports_location_report: boolean;
  capability_json: Record<string, unknown>;
  default_config_json: Record<string, unknown>;
  form_schema_json: Record<string, unknown>;
  enabled: boolean;
  remarks: string;
}

function buildVersioningTemplate(input: {
  policyCode: string;
  bundleSeed: string;
  softwareFamilies: string[];
  embeddedFamilies: string[];
  hardwareModels: Array<{ sku: string; revisions: string[]; name: string }>;
}) {
  return {
    policy_code: input.policyCode,
    business_domain: 'smart_irrigation_controller',
    bundle_code_seed: input.bundleSeed,
    naming_scheme: {
      software_pattern: 'SW-{bundle_code}-v{semver}',
      embedded_pattern: 'EMB-{firmware_family}-v{semver}',
      hardware_pattern: 'HW-{hardware_sku}-{hardware_rev}',
      config_pattern: 'CFG-v{config_version}',
    },
    software_catalog: input.softwareFamilies.map((family) => ({
      family,
      release_type: 'platform_edge',
      version_pattern: 'SW-{bundle_code}-v{semver}',
    })),
    embedded_catalog: input.embeddedFamilies.map((family) => ({
      family,
      release_type: 'embedded_firmware',
      version_pattern: 'EMB-{firmware_family}-v{semver}',
    })),
    hardware_catalog: input.hardwareModels.map((item) => ({
      sku: item.sku,
      name: item.name,
      revisions: item.revisions,
      version_pattern: 'HW-{hardware_sku}-{hardware_rev}',
    })),
    upgrade_units: ['software_version', 'firmware_version', 'config_version'],
    compatibility_keys: [
      'hardware_sku',
      'hardware_rev',
      'software_version',
      'firmware_family',
      'firmware_version',
      'protocol_version',
      'config_version',
    ],
  };
}

export const STANDARD_DEVICE_TYPE_TEMPLATES: StandardDeviceTypeTemplate[] = [
  {
    type_code: 'HJ_SOURCE_CONTROLLER_V2',
    type_name: '水源控制器 v2',
    device_category: 'controller',
    preferred_comm_identity_type: 'imei',
    supports_control: true,
    supports_telemetry: true,
    supports_location_report: false,
    capability_json: {
      protocol: 'hj-device-v2',
      roles: ['source_controller'],
      metrics: ['pressure_mpa', 'flow_m3h', 'total_m3', 'power_kw', 'energy_kwh', 'pump_state'],
      feature_modules: ['pump_vfd_control', 'pressure_acquisition', 'flow_acquisition', 'electric_meter_modbus'],
      supports_control: true,
      supports_telemetry: true,
      supports_location_report: false,
      remarks: '标准水源侧灌溉控制器，支持水泵、压力、流量和电参量遥测。',
    },
    default_config_json: {
      preferred_comm_identity_type: 'imei',
      versioning: buildVersioningTemplate({
        policyCode: 'source_controller_policy_v1',
        bundleSeed: 'IRR-SRC-STD-HJ-DEVICE-V2',
        softwareFamilies: ['edge-control'],
        embeddedFamilies: ['hj-source-core'],
        hardwareModels: [
          { sku: 'HJC-SRC-4G', revisions: ['A01', 'A02'], name: '4G 水源控制板' },
          { sku: 'HJC-SRC-NB', revisions: ['A01'], name: 'NB 水源控制板' },
        ],
      }),
    },
    form_schema_json: {
      ui_mode: 'source_controller',
    },
    enabled: true,
    remarks: '用于井口和水源泵控制的主标准类型。',
  },
  {
    type_code: 'HJ_VALVE_CONTROLLER_V2',
    type_name: '阀门控制器 v2',
    device_category: 'actuator',
    preferred_comm_identity_type: 'imei',
    supports_control: true,
    supports_telemetry: true,
    supports_location_report: false,
    capability_json: {
      protocol: 'hj-device-v2',
      roles: ['valve_controller'],
      metrics: ['valve_state', 'flow_m3h', 'total_m3'],
      feature_modules: ['single_valve_control', 'flow_acquisition'],
      supports_control: true,
      supports_telemetry: true,
      supports_location_report: false,
      remarks: '标准田间阀门控制器，支持本地互锁和流量反馈。',
    },
    default_config_json: {
      preferred_comm_identity_type: 'imei',
      versioning: buildVersioningTemplate({
        policyCode: 'valve_controller_policy_v1',
        bundleSeed: 'IRR-VAL-STD-HJ-DEVICE-V2',
        softwareFamilies: ['edge-control'],
        embeddedFamilies: ['hj-valve-core'],
        hardwareModels: [
          { sku: 'HJC-VAL-2R', revisions: ['A01', 'A02'], name: '2 路继电器阀门控制板' },
        ],
      }),
    },
    form_schema_json: {
      ui_mode: 'valve_controller',
    },
    enabled: true,
    remarks: '用于出水口和支路控制的标准单阀控制器模板。',
  },
  {
    type_code: 'HJ_MONITOR_CONTROLLER_V2',
    type_name: '监测控制器 v2',
    device_category: 'collector',
    preferred_comm_identity_type: 'imei',
    supports_control: false,
    supports_telemetry: true,
    supports_location_report: false,
    capability_json: {
      protocol: 'hj-device-v2',
      roles: ['monitor_controller'],
      metrics: ['pressure_mpa', 'flow_m3h', 'soil_moisture_vwc', 'soil_temperature_c'],
      feature_modules: [
        'pressure_acquisition',
        'flow_acquisition',
        'soil_moisture_acquisition',
        'soil_temperature_acquisition',
      ],
      supports_control: false,
      supports_telemetry: true,
      supports_location_report: false,
      remarks: '标准纯遥测控制器模板，适用于压力、流量和土壤传感。',
    },
    default_config_json: {
      preferred_comm_identity_type: 'imei',
      versioning: buildVersioningTemplate({
        policyCode: 'monitor_controller_policy_v1',
        bundleSeed: 'IRR-MON-STD-HJ-DEVICE-V2',
        softwareFamilies: ['edge-control'],
        embeddedFamilies: ['hj-monitor-core'],
        hardwareModels: [
          { sku: 'HJC-MON-RS485', revisions: ['A01'], name: 'RS485 监测板' },
        ],
      }),
    },
    form_schema_json: {
      ui_mode: 'monitor_controller',
    },
    enabled: true,
    remarks: '用于纯监测部署的标准遥测采集模板。',
  },
  {
    type_code: 'HJ_HYBRID_CONTROLLER_V2',
    type_name: '混合控制器 v2',
    device_category: 'controller',
    preferred_comm_identity_type: 'imei',
    supports_control: true,
    supports_telemetry: true,
    supports_location_report: false,
    capability_json: {
      protocol: 'hj-device-v2',
      roles: ['hybrid_controller'],
      metrics: ['pressure_mpa', 'flow_m3h', 'total_m3', 'pump_state', 'valve_state', 'power_kw'],
      feature_modules: [
        'pump_vfd_control',
        'single_valve_control',
        'pressure_acquisition',
        'flow_acquisition',
        'electric_meter_modbus',
      ],
      supports_control: true,
      supports_telemetry: true,
      supports_location_report: false,
      remarks: '标准混合控制器，适用于水源加阀门一体化部署。',
    },
    default_config_json: {
      preferred_comm_identity_type: 'imei',
      versioning: buildVersioningTemplate({
        policyCode: 'hybrid_controller_policy_v1',
        bundleSeed: 'IRR-HYB-INT-HJ-DEVICE-V2',
        softwareFamilies: ['edge-control'],
        embeddedFamilies: ['hj-hybrid-core'],
        hardwareModels: [
          { sku: 'HJC-HYB-4R', revisions: ['A01', 'A02'], name: '混合一体化控制板' },
        ],
      }),
    },
    form_schema_json: {
      ui_mode: 'hybrid_controller',
    },
    enabled: true,
    remarks: '适用于紧凑型泵阀一体站的标准一体化控制器模板。',
  },
  {
    type_code: 'HJ_GATEWAY_CONTROLLER_V2',
    type_name: '网关一体控制器 v2',
    device_category: 'gateway',
    preferred_comm_identity_type: 'imei',
    supports_control: false,
    supports_telemetry: true,
    supports_location_report: true,
    capability_json: {
      protocol: 'hj-device-v2',
      roles: ['gateway_integrated'],
      metrics: ['connectivity', 'subdevice_count', 'signal_csq'],
      feature_modules: ['rs485_vfd_gateway'],
      supports_control: false,
      supports_telemetry: true,
      supports_location_report: true,
      remarks: '标准网关一体控制器，适用于子设备聚合和桥接场景。',
    },
    default_config_json: {
      preferred_comm_identity_type: 'imei',
      versioning: buildVersioningTemplate({
        policyCode: 'gateway_controller_policy_v1',
        bundleSeed: 'IRR-GTW-INT-HJ-DEVICE-V2',
        softwareFamilies: ['edge-control'],
        embeddedFamilies: ['hj-gateway-core'],
        hardwareModels: [
          { sku: 'HJC-GTW-4G', revisions: ['A01'], name: '4G 一体化网关板' },
        ],
      }),
    },
    form_schema_json: {
      ui_mode: 'gateway_integrated',
    },
    enabled: true,
    remarks: '用于受管子设备和桥接部署的标准网关模板。',
  },
];
