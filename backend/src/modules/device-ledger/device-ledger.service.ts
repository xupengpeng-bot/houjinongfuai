import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ArchiveService } from '../../common/archive/archive.service';
import { DatabaseService } from '../../common/db/database.service';
import {
  buildSpatialLocationReadModelDevice,
  resolveEffectiveLocation,
  type SpatialLocationReadModelV1
} from '../../common/location/effective-location';
import { assertNoForbiddenSpatialWriteKeys } from '../../common/location/spatial-location-semantics';
import { DeviceLedgerRepository, type LedgerDeviceRow, PHASE1_TENANT_ID } from './device-ledger.repository';
import { RuntimeIngestService } from '../runtime-ingest/runtime-ingest.service';
import { buildDeviceVersionContract, type DeviceVersionContract } from './device-versioning';

export type LedgerDeviceWithLocation = LedgerDeviceRow & {
  map_display_latitude: number | null;
  map_display_longitude: number | null;
  location_read_model: SpatialLocationReadModelV1;
  sn: string;
  name: string;
  type: string;
  area: string | null;
  well: string | null;
};

export interface CreateLedgerDeviceBody {
  device_code: string;
  device_name: string;
  imei?: string | null;
  device_type: string;
  asset_id?: string | null;
  project_id?: string | null;
  block_id?: string | null;
  source_module?: string | null;
  source_node_code?: string | null;
  source_unit_code?: string | null;
  manual_region_id?: string | null;
  manual_address_text?: string | null;
  manual_latitude?: number | null;
  manual_longitude?: number | null;
  install_position_desc?: string | null;
  location_source_strategy?: string | null;
  software_family?: string | null;
  software_version?: string | null;
  hardware_sku?: string | null;
  hardware_rev?: string | null;
  firmware_family?: string | null;
  meter_protocol?: string | null;
  control_protocol?: string | null;
  controller_role?: string | null;
  deployment_mode?: string | null;
  config_version?: number | null;
  capability_version?: number | null;
  capability_hash?: string | null;
  config_bitmap?: string | null;
  actions_bitmap?: string | null;
  queries_bitmap?: string | null;
  feature_modules?: string[] | null;
  capability_limits?: Record<string, unknown> | null;
  resource_inventory?: Record<string, unknown> | null;
  control_config?: Record<string, unknown> | null;
  channel_bindings?: unknown[] | null;
  runtime_rules?: Record<string, unknown> | null;
  last_register_payload?: Record<string, unknown> | null;
  auto_identified?: boolean | null;
}

export interface UpdateLedgerDeviceBody {
  device_name?: string;
  imei?: string | null;
  device_type?: string;
  asset_id?: string | null;
  project_id?: string | null;
  block_id?: string | null;
  source_module?: string | null;
  source_node_code?: string | null;
  source_unit_code?: string | null;
  manual_region_id?: string | null;
  manual_address_text?: string | null;
  manual_latitude?: number | null;
  manual_longitude?: number | null;
  install_position_desc?: string | null;
  location_source_strategy?: string | null;
  software_family?: string | null;
  software_version?: string | null;
  hardware_sku?: string | null;
  hardware_rev?: string | null;
  firmware_family?: string | null;
  meter_protocol?: string | null;
  control_protocol?: string | null;
  controller_role?: string | null;
  deployment_mode?: string | null;
  config_version?: number | null;
  capability_version?: number | null;
  capability_hash?: string | null;
  config_bitmap?: string | null;
  actions_bitmap?: string | null;
  queries_bitmap?: string | null;
  feature_modules?: string[] | null;
  capability_limits?: Record<string, unknown> | null;
  resource_inventory?: Record<string, unknown> | null;
  control_config?: Record<string, unknown> | null;
  channel_bindings?: unknown[] | null;
  runtime_rules?: Record<string, unknown> | null;
  last_register_payload?: Record<string, unknown> | null;
  auto_identified?: boolean | null;
}

export interface ArchiveLedgerDeviceBody {
  archive_reason?: string;
  reason_text?: string | null;
  trigger_type?: string;
  source_module?: string;
  source_action?: string;
  ui_entry?: string | null;
  request_id?: string | null;
  batch_id?: string | null;
  operator_id?: string | null;
  operator_name?: string | null;
}

export interface DeviceIntegrationProfile {
  device: {
    id: string;
    device_code: string;
    device_name: string;
    imei: string | null;
    device_type_code: string | null;
    device_type_name: string;
    device_family: string | null;
    protocol_type: string | null;
    protocol_version: string | null;
    software_family: string | null;
    software_version: string | null;
    hardware_sku: string | null;
    hardware_rev: string | null;
    firmware_family: string | null;
    firmware_version: string | null;
    meter_protocol: string | null;
    control_protocol: string | null;
  };
  version_contract: DeviceVersionContract;
  platform_binding: {
    project_id: string | null;
    project_name: string | null;
    asset_id: string | null;
    asset_name: string | null;
    block_id: string | null;
    source_module: string | null;
    source_node_code: string | null;
    source_unit_code: string | null;
    controller_role: string | null;
    deployment_mode: string | null;
    logical_unit_code: string | null;
    binding_defaults: Record<string, unknown>;
    auto_profiles: Record<string, unknown>;
  };
  capability_model: {
    integration_mode: 'single_role_device' | 'multi_module_controller';
    supports_control: boolean;
    supports_telemetry: boolean;
    supports_location_report: boolean;
    roles: string[];
    metrics: string[];
    feature_modules: string[];
    capability_version: number | null;
    capability_hash: string | null;
    config_bitmap: string | null;
    actions_bitmap: string | null;
    queries_bitmap: string | null;
    capability_limits: Record<string, unknown>;
    resource_inventory: Record<string, unknown>;
    auto_identity_keys: string[];
    meter_protocol: string | null;
    control_protocol: string | null;
  };
  channel_model: {
    template_channels: Array<Record<string, unknown>>;
    bound_channels: Array<Record<string, unknown>>;
    effective_channels: Array<Record<string, unknown>>;
  };
  command_contract: {
    adapter_code: string;
    envelope_protocol: string;
    identity_key: string;
    supported_command_codes: string[];
    supported_query_codes: string[];
  };
  platform_contract: {
    supported_scenarios: Array<{
      scenario_code: string;
      readiness: 'ready' | 'partial' | 'blocked';
      reason: string;
    }>;
    heartbeat_contract: {
      lightweight_fields: string[];
      recommended_interval_seconds: number;
      config_echo_fields: string[];
      capability_echo_fields: string[];
    };
    telemetry_contract: {
      snapshot_metrics: string[];
      idle_interval_seconds: number;
      running_interval_seconds: number;
      alarm_burst_interval_seconds: number;
    };
    config_contract: {
      sync_mode: string;
      supported_domains: string[];
      protection_fields: string[];
      version_field: string;
    };
    execution_contract: {
      local_edge_flows: string[];
      blocking_resources: string[];
      conflict_actions: string[];
    };
  };
  management_view: {
    preferred_comm_identity_type: string | null;
    comm_identity_type: string | null;
    comm_identity_value: string | null;
    ui_mode: string | null;
    form_sections: Array<Record<string, unknown>>;
    remarks: string | null;
    last_register_payload: Record<string, unknown> | null;
  };
  runtime_projection: {
    status: string;
    online_state: string | null;
    connection_state: string | null;
    lifecycle_state: string | null;
    runtime_state: string | null;
    last_report: string | null;
    config_version: number | null;
    auto_identified: boolean;
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArrayOfObjects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
        .map((item) => asObject(item))
        .filter((item) => Object.keys(item).length > 0)
    : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function scenarioReadinessRank(readiness: 'ready' | 'partial' | 'blocked') {
  if (readiness === 'ready') return 3;
  if (readiness === 'partial') return 2;
  return 1;
}

const EXPOSED_PLATFORM_FEATURE_MODULES = new Set([
  'payment_qr_control',
  'card_auth_reader',
  'electric_meter_modbus',
  'power_monitoring',
  'pump_vfd_control',
  'pump_direct_control',
  'relay_output_control',
  'single_valve_control',
  'dual_valve_control',
  'rs485_sensor_gateway',
]);
const BASE_PLATFORM_COMMAND_CODES = ['SYNC_CONFIG', 'pause_session', 'resume_session', 'play_voice_prompt'];
const BASE_PLATFORM_QUERY_CODES = ['query_common_status', 'query_workflow_state'];

const FEATURE_MODULE_COMMANDS: Record<string, string[]> = {
  pump_vfd_control: ['start_pump', 'stop_pump'],
  pump_direct_control: ['start_pump', 'stop_pump'],
  relay_output_control: ['open_relay', 'close_relay'],
  single_valve_control: ['open_valve', 'close_valve'],
  dual_valve_control: ['open_valve', 'close_valve'],
  payment_qr_control: [],
  card_auth_reader: [],
  electric_meter_modbus: [],
  power_monitoring: [],
  rs485_sensor_gateway: [],
};

const FEATURE_MODULE_QUERIES: Record<string, string[]> = {
  electric_meter_modbus: ['query_electric_meter'],
  power_monitoring: ['query_electric_meter'],
  payment_qr_control: [],
  card_auth_reader: [],
  pump_vfd_control: [],
  pump_direct_control: [],
  single_valve_control: [],
  dual_valve_control: [],
  rs485_sensor_gateway: [],
};

const FEATURE_MODULE_METRICS: Record<string, string[]> = {
  electric_meter_modbus: ['voltage_v', 'current_a', 'power_kw', 'energy_kwh', 'meter_protocol'],
  power_monitoring: ['voltage_v', 'current_a', 'power_kw', 'energy_kwh'],
  payment_qr_control: [],
  card_auth_reader: [],
  pump_vfd_control: ['runtime_sec'],
  pump_direct_control: ['runtime_sec'],
  single_valve_control: [],
  dual_valve_control: [],
  rs485_sensor_gateway: [],
};

const FEATURE_MODULE_BLOCKING_RESOURCES: Record<string, string[]> = {
  pump_vfd_control: ['relay_1', 'relay_2'],
  pump_direct_control: ['pump_drive', 'relay_2'],
  single_valve_control: ['valve_output', 'relay_1'],
  dual_valve_control: ['valve_1', 'valve_2'],
  electric_meter_modbus: ['rs485_1'],
  power_monitoring: ['power_monitor_bus'],
  payment_qr_control: ['payment_qr'],
  card_auth_reader: ['card_reader'],
  rs485_sensor_gateway: ['rs485_1'],
};

const FEATURE_MODULE_EDGE_FLOWS: Record<string, string[]> = {
  pump_vfd_control: ['local_start_sequence', 'local_stop_sequence'],
  pump_direct_control: ['local_start_sequence', 'local_stop_sequence'],
  single_valve_control: ['local_start_sequence', 'local_stop_sequence'],
  dual_valve_control: ['local_open_sequence', 'local_close_sequence'],
};

const FEATURE_MODULE_SCENARIOS: Record<
  string,
  Array<{ scenario_code: string; readiness: 'ready' | 'partial' | 'blocked'; reason: string }>
> = {
  pump_vfd_control: [
    { scenario_code: 'pay_then_start', readiness: 'partial', reason: 'requires payment callback + vfd start/stop control' },
  ],
  pump_direct_control: [
    { scenario_code: 'pay_then_start', readiness: 'partial', reason: 'requires payment callback + direct pump control' },
  ],
  single_valve_control: [
    { scenario_code: 'scan_to_irrigate', readiness: 'partial', reason: 'requires valve + payment + runtime monitoring' },
    { scenario_code: 'card_to_irrigate', readiness: 'partial', reason: 'requires local card auth flow + valve control' },
  ],
  dual_valve_control: [
    { scenario_code: 'scan_to_irrigate', readiness: 'partial', reason: 'requires dual-valve control + payment + runtime monitoring' },
    { scenario_code: 'card_to_irrigate', readiness: 'partial', reason: 'requires local card auth flow + dual-valve control' },
  ],
  electric_meter_modbus: [
    { scenario_code: 'energy_monitored_irrigation', readiness: 'ready', reason: 'power telemetry available during runtime' },
  ],
  payment_qr_control: [
    { scenario_code: 'scan_to_irrigate', readiness: 'ready', reason: 'qr payment flow is available on device' },
  ],
  card_auth_reader: [
    { scenario_code: 'card_to_irrigate', readiness: 'ready', reason: 'card auth flow is available on device' },
  ],
};

function filterExposedPlatformFeatureModules(featureModules: string[]) {
  return featureModules.filter((moduleCode) => EXPOSED_PLATFORM_FEATURE_MODULES.has(moduleCode));
}

function buildReleasedArchivedDeviceCode(deviceCode: string, id: string): string {
  const suffix = `-ARC-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const base = (deviceCode || 'DEVICE').slice(0, Math.max(1, 64 - suffix.length));
  return `${base}${suffix}`;
}

@Injectable()
export class DeviceLedgerService {
  constructor(
    private readonly repo: DeviceLedgerRepository,
    private readonly db: DatabaseService,
    private readonly archiveService: ArchiveService,
    private readonly runtimeIngestService: RuntimeIngestService,
  ) {}

  private tenant(): string {
    return PHASE1_TENANT_ID;
  }

  private enrichLocation(row: LedgerDeviceRow): LedgerDeviceWithLocation {
    const eff = resolveEffectiveLocation({
      strategy: row.location_source_strategy,
      manual: { lat: row.manual_latitude, lng: row.manual_longitude },
      reported: { lat: row.reported_latitude, lng: row.reported_longitude }
    });
    const effective_latitude = eff.lat;
    const effective_longitude = eff.lng;
    const effective_location_source = eff.source === 'none' ? null : eff.source;
    return {
      ...row,
      effective_latitude,
      effective_longitude,
      effective_location_source,
      sn: row.device_code,
      name: row.device_name,
      type: row.device_type,
      area: row.region_name,
      well: row.asset_name ?? row.project_name ?? null,
      map_display_latitude: effective_latitude,
      map_display_longitude: effective_longitude,
      location_read_model: buildSpatialLocationReadModelDevice({
        ...row,
        effective_latitude,
        effective_longitude,
        effective_location_source
      })
    };
  }

  async list(params: {
    page: number;
    pageSize: number;
    projectId?: string;
    blockId?: string;
    assetId?: string;
    deviceTypeId?: string;
    displayStatus?: 'online' | 'offline' | 'alarm';
    q?: string;
  }) {
    const { items, total } = await this.repo.findMany({
      tenantId: this.tenant(),
      ...params
    });
    return { items: items.map((r) => this.enrichLocation(r)), total };
  }

  async getById(id: string) {
    const row = await this.repo.findById(this.tenant(), id);
    if (!row) throw new NotFoundException('device not found');
    return this.enrichLocation(row);
  }

  async getTelemetry(id: string) {
    const row = await this.repo.findById(this.tenant(), id);
    if (!row) throw new NotFoundException('device not found');

    const shadow = await this.runtimeIngestService.getRuntimeShadowByDeviceId(this.tenant(), id);
    const health = await this.runtimeIngestService.getRuntimeHealthSnapshot(this.tenant(), id);
    const channels = await this.runtimeIngestService.listChannelLatest({
      tenantId: this.tenant(),
      deviceId: id,
      limit: 300,
    });

    return {
      id,
      imei: row.imei,
      runtime_shadow: shadow,
      runtime_health: health,
      channel_latest: channels,
    };
  }

  private buildEffectiveChannelModel(
    featureModules: string[],
    typeDefaultConfigJson: Record<string, unknown>,
    row: LedgerDeviceRow,
  ) {
    const channelTemplates = asObject(typeDefaultConfigJson.channelTemplates);
    const templateChannels = featureModules.flatMap((moduleCode) =>
      asArrayOfObjects(channelTemplates[moduleCode]).map((item) => ({
        feature_module: moduleCode,
        ...item,
      })),
    );
    const boundChannels = asArrayOfObjects(row.channel_bindings);
    const templateByRole = new Map<string, Record<string, unknown>>();

    for (const item of templateChannels) {
      const normalizedItem = asObject(item);
      const role = String(normalizedItem.channel_role ?? '').trim();
      if (role && !templateByRole.has(role)) {
        templateByRole.set(role, normalizedItem);
      }
    }

    const effectiveChannels = boundChannels.length > 0
      ? boundChannels.map((binding) => {
          const role = String(binding.channel_role ?? '').trim();
          const template = role ? templateByRole.get(role) : undefined;
          return {
            ...template,
            ...binding,
            feature_module:
              binding.feature_module ??
              binding.featureModule ??
              template?.feature_module ??
              null,
          };
        })
      : templateChannels;

    return {
      template_channels: templateChannels,
      bound_channels: boundChannels,
      effective_channels: effectiveChannels,
    };
  }

  private buildIntegrationProfile(row: LedgerDeviceRow): DeviceIntegrationProfile {
    const typeCapabilityJson = asObject(row.type_capability_json);
    const typeDefaultConfigJson = asObject(row.type_default_config_json);
    const typeFormSchemaJson = asObject(row.type_form_schema_json);
    const typeVersioning = asObject(typeDefaultConfigJson.versioning);
    const featureModulesFromLedger = uniqueStrings(asStringArray(row.feature_modules));
    const featureModules =
      featureModulesFromLedger.length > 0
        ? featureModulesFromLedger
        : uniqueStrings(asStringArray(typeCapabilityJson.feature_modules));
    const exposedFeatureModules = filterExposedPlatformFeatureModules(featureModules);
    const resourceInventory = {
      ...asObject(typeCapabilityJson.resource_inventory),
      ...asObject(row.resource_inventory),
    };
    const commandCodes = uniqueStrings([
      ...BASE_PLATFORM_COMMAND_CODES,
      ...exposedFeatureModules.flatMap((moduleCode) => FEATURE_MODULE_COMMANDS[moduleCode] ?? []),
    ]);
    const queryCodes = uniqueStrings([
      ...BASE_PLATFORM_QUERY_CODES,
      ...exposedFeatureModules.flatMap((moduleCode) => FEATURE_MODULE_QUERIES[moduleCode] ?? []),
    ]);
    const channelModel = this.buildEffectiveChannelModel(exposedFeatureModules, typeDefaultConfigJson, row);
    const sections = asArrayOfObjects(typeFormSchemaJson.sections);
    const bindingDefaults = asObject(typeDefaultConfigJson.bindingDefaults);
    const autoProfiles = asObject(typeDefaultConfigJson.autoProfiles);
    const deviceFamily = String(row.device_family ?? '').trim().toLowerCase();
    const resolvedProtocolType = row.protocol_type || String(typeCapabilityJson.protocol ?? '') || null;
    const meterProtocol = row.meter_protocol || String(typeCapabilityJson.meter_protocol ?? '') || null;
    const controlProtocol = row.control_protocol || String(typeCapabilityJson.control_protocol ?? '') || null;
    const registerPayload = asObject(row.last_register_payload);
    const capabilityVersion =
      row.capability_version ?? asInteger(registerPayload.capability_version ?? registerPayload.cap_ver);
    const capabilityHash =
      row.capability_hash ?? asTrimmedString(registerPayload.capability_hash ?? registerPayload.cap_hash);
    const configBitmap = row.config_bitmap ?? asTrimmedString(registerPayload.config_bitmap);
    const actionsBitmap = row.actions_bitmap ?? asTrimmedString(registerPayload.actions_bitmap);
    const queriesBitmap = row.queries_bitmap ?? asTrimmedString(registerPayload.queries_bitmap);
    const capabilityLimits = {
      ...asObject(registerPayload.limits),
      ...asObject(row.capability_limits),
    };
    const roles = uniqueStrings([
      row.controller_role,
      ...asStringArray(typeCapabilityJson.roles),
    ]);
    const logicalUnitCode = uniqueStrings([
      row.source_node_code,
      row.source_unit_code,
      row.controller_role,
    ]).join(':') || null;
    const blockingResources = uniqueStrings(
      exposedFeatureModules.flatMap((moduleCode) => FEATURE_MODULE_BLOCKING_RESOURCES[moduleCode] ?? []),
    );
    const localEdgeFlows = uniqueStrings([
      ...exposedFeatureModules.flatMap((moduleCode) => FEATURE_MODULE_EDGE_FLOWS[moduleCode] ?? []),
      ...(row.protocol_type === 'hj-device-v2' ? ['heartbeat_runtime_sync'] : []),
    ]);
    const supportedScenariosMap = new Map<
      string,
      { scenario_code: string; readiness: 'ready' | 'partial' | 'blocked'; reason: string }
    >();
    for (const scenario of exposedFeatureModules.flatMap((moduleCode) => FEATURE_MODULE_SCENARIOS[moduleCode] ?? [])) {
      const existing = supportedScenariosMap.get(scenario.scenario_code);
      if (
        !existing ||
        scenarioReadinessRank(scenario.readiness) > scenarioReadinessRank(existing.readiness)
      ) {
        supportedScenariosMap.set(scenario.scenario_code, scenario);
      }
    }
    const protectionFields = [
      'overload_protection',
      'phase_loss_protection',
      'under_voltage_protection',
      'over_voltage_protection',
      'dry_run_protection',
      'pressure_high_limit',
      'pressure_low_limit',
      'start_delay_ms',
      'stop_delay_ms',
    ];
    const derivedMetrics = uniqueStrings([
      ...exposedFeatureModules.flatMap((moduleCode) => FEATURE_MODULE_METRICS[moduleCode] ?? []),
      ...asStringArray(typeCapabilityJson.metrics),
    ]);
    const telemetryMetrics = uniqueStrings(derivedMetrics);
    const supportsControl =
      typeof typeCapabilityJson.supports_control === 'boolean'
        ? (typeCapabilityJson.supports_control as boolean)
        : ['controller', 'well', 'pump', 'valve', 'actuator'].includes(deviceFamily);
    const supportsTelemetry =
      typeof typeCapabilityJson.supports_telemetry === 'boolean'
        ? (typeCapabilityJson.supports_telemetry as boolean)
        : asStringArray(typeCapabilityJson.metrics).length > 0 || featureModules.length > 0;
    const supportsLocationReport =
      typeof typeCapabilityJson.supports_location_report === 'boolean'
        ? (typeCapabilityJson.supports_location_report as boolean)
        : false;
    const actualProtocol = row.protocol_type || String(typeCapabilityJson.protocol ?? '') || 'unknown';
    const versionContract = buildDeviceVersionContract({
      protocolType: resolvedProtocolType,
      controllerRole: row.controller_role,
      deploymentMode: row.deployment_mode,
      softwareFamily: row.software_family,
      softwareVersion: row.software_version,
      firmwareFamily: row.firmware_family,
      firmwareVersion: row.firmware_version,
      hardwareSku: row.hardware_sku,
      hardwareRev: row.hardware_rev,
      configVersion: row.config_version,
      typeVersioning,
    });

    return {
      device: {
        id: row.id,
        device_code: row.device_code,
        device_name: row.device_name,
        imei: row.imei,
        device_type_code: row.device_type_code,
        device_type_name: row.device_type,
        device_family: row.device_family,
        protocol_type: resolvedProtocolType,
        protocol_version: row.protocol_version,
        software_family: row.software_family,
        software_version: row.software_version,
        hardware_sku: row.hardware_sku,
        hardware_rev: row.hardware_rev,
        firmware_family: row.firmware_family,
        firmware_version: row.firmware_version,
        meter_protocol: meterProtocol,
        control_protocol: controlProtocol,
      },
      version_contract: versionContract,
      platform_binding: {
        project_id: row.project_id,
        project_name: row.project_name,
        asset_id: row.asset_id,
        asset_name: row.asset_name,
        block_id: row.block_id,
        source_module: row.source_module,
        source_node_code: row.source_node_code,
        source_unit_code: row.source_unit_code,
        controller_role: row.controller_role,
        deployment_mode: row.deployment_mode,
        logical_unit_code: logicalUnitCode,
        binding_defaults: bindingDefaults,
        auto_profiles: autoProfiles,
      },
      capability_model: {
        integration_mode: exposedFeatureModules.length > 1 ? 'multi_module_controller' : 'single_role_device',
        supports_control: supportsControl,
        supports_telemetry: supportsTelemetry,
        supports_location_report: supportsLocationReport,
        roles,
        metrics: telemetryMetrics,
        feature_modules: exposedFeatureModules,
        capability_version: capabilityVersion,
        capability_hash: capabilityHash,
        config_bitmap: configBitmap,
        actions_bitmap: actionsBitmap,
        queries_bitmap: queriesBitmap,
        capability_limits: capabilityLimits,
        resource_inventory: resourceInventory,
        auto_identity_keys: asStringArray(typeCapabilityJson.auto_identity_keys),
        meter_protocol: meterProtocol,
        control_protocol: controlProtocol,
      },
      channel_model: channelModel,
      command_contract: {
        adapter_code: actualProtocol,
        envelope_protocol: actualProtocol,
        identity_key:
          String(typeDefaultConfigJson.preferred_comm_identity_type ?? row.comm_identity_type ?? 'imei') || 'imei',
        supported_command_codes: commandCodes,
        supported_query_codes: queryCodes,
      },
      platform_contract: {
        supported_scenarios: Array.from(supportedScenariosMap.values()),
        heartbeat_contract: {
          lightweight_fields: [
            'online',
            'ready',
            'tcp_connected',
            'config_version',
            'capability_hash',
            'signal_csq',
            'battery_soc',
            'battery_voltage_v',
            'solar_voltage_v',
            'workflow_state',
            'power_mode',
            'alarm_codes',
          ],
          recommended_interval_seconds: 30,
          config_echo_fields: ['config_version', 'feature_modules', 'software_family', 'software_version'],
          capability_echo_fields: ['capability_version', 'capability_hash', 'config_bitmap', 'actions_bitmap', 'queries_bitmap'],
        },
        telemetry_contract: {
          snapshot_metrics: telemetryMetrics,
          idle_interval_seconds: 120,
          running_interval_seconds: 10,
          alarm_burst_interval_seconds: 5,
        },
        config_contract: {
          sync_mode: 'versioned_sync_config',
          supported_domains: ['feature_modules', 'control_config', 'channel_bindings', 'runtime_rules', 'protection_config'],
          protection_fields: protectionFields,
          version_field: 'config_version',
        },
        execution_contract: {
          local_edge_flows: localEdgeFlows,
          blocking_resources: uniqueStrings([
            ...blockingResources,
            'audio_bus',
            'card_reader',
            'net_session',
          ]),
          conflict_actions: [
            'open_valve vs close_valve',
            'start_pump vs stop_pump',
            'play_voice_prompt vs play_voice_prompt',
            'local_card_auth_flow vs local_card_auth_flow',
          ],
        },
      },
      management_view: {
        preferred_comm_identity_type:
          String(typeDefaultConfigJson.preferred_comm_identity_type ?? '') || null,
        comm_identity_type: row.comm_identity_type,
        comm_identity_value: row.comm_identity_value,
        ui_mode: String(typeFormSchemaJson.ui_mode ?? '') || null,
        form_sections: sections,
        remarks: String(typeCapabilityJson.remarks ?? '') || null,
        last_register_payload: row.last_register_payload,
      },
      runtime_projection: {
        status: row.status,
        online_state: row.online_state,
        connection_state: row.connection_state,
        lifecycle_state: row.lifecycle_state,
        runtime_state: row.runtime_state,
        last_report: row.last_report,
        config_version: row.config_version,
        auto_identified: Boolean(row.auto_identified),
      },
    };
  }

  async getIntegrationProfile(id: string) {
    const row = await this.repo.findById(this.tenant(), id);
    if (!row) throw new NotFoundException('device not found');
    return this.buildIntegrationProfile(row);
  }

  async create(body: CreateLedgerDeviceBody) {
    assertNoForbiddenSpatialWriteKeys(body as unknown as Record<string, unknown>);
    const tid = this.tenant();
    const typeId = await this.repo.resolveDeviceTypeId(tid, body.device_type);
    if (!typeId) throw new BadRequestException('device_type not found');

    const assetId = body.asset_id?.trim() || null;
    const projectId = body.project_id?.trim() || null;
    if (!assetId && !projectId) {
      throw new BadRequestException('asset_id or project_id is required');
    }

    const regionId = assetId
      ? await this.repo.resolveRegionIdForAsset(tid, assetId)
      : await this.repo.resolveRegionIdForProject(tid, projectId!);
    if (!regionId) {
      throw new BadRequestException(assetId ? 'asset not found or region not resolvable' : 'project not found or region not resolvable');
    }

    const normalizedImei = body.imei?.trim() || null;
    const ext: Record<string, unknown> = {};
    if (projectId !== null) ext.project_id = projectId;
    if (body.block_id !== undefined) ext.block_id = body.block_id?.trim() || null;
    if (body.source_module !== undefined) ext.source_module = body.source_module?.trim() || null;
    if (body.source_node_code !== undefined) ext.source_node_code = body.source_node_code?.trim() || null;
    if (body.source_unit_code !== undefined) ext.source_unit_code = body.source_unit_code?.trim() || null;
    if (body.manual_region_id !== undefined) ext.manual_region_id = body.manual_region_id;
    if (body.manual_address_text !== undefined) ext.manual_address_text = body.manual_address_text;
    if (body.manual_latitude !== undefined) ext.manual_latitude = body.manual_latitude;
    if (body.manual_longitude !== undefined) ext.manual_longitude = body.manual_longitude;
    if (body.install_position_desc !== undefined) ext.install_position_desc = body.install_position_desc;
    if (body.location_source_strategy !== undefined) ext.location_source_strategy = body.location_source_strategy;
    if (body.software_family !== undefined) ext.software_family = body.software_family?.trim() || null;
    if (body.software_version !== undefined) ext.software_version = body.software_version?.trim() || null;
    if (body.hardware_sku !== undefined) ext.hardware_sku = body.hardware_sku?.trim() || null;
    if (body.hardware_rev !== undefined) ext.hardware_rev = body.hardware_rev?.trim() || null;
    if (body.firmware_family !== undefined) ext.firmware_family = body.firmware_family?.trim() || null;
    if (body.meter_protocol !== undefined) ext.meter_protocol = body.meter_protocol?.trim() || null;
    if (body.control_protocol !== undefined) ext.control_protocol = body.control_protocol?.trim() || null;
    if (body.controller_role !== undefined) ext.controller_role = body.controller_role?.trim() || null;
    if (body.deployment_mode !== undefined) ext.deployment_mode = body.deployment_mode?.trim() || null;
    if (body.config_version !== undefined) ext.config_version = body.config_version;
    if (body.capability_version !== undefined) ext.capability_version = body.capability_version;
    if (body.capability_hash !== undefined) ext.capability_hash = body.capability_hash?.trim() || null;
    if (body.config_bitmap !== undefined) ext.config_bitmap = body.config_bitmap?.trim() || null;
    if (body.actions_bitmap !== undefined) ext.actions_bitmap = body.actions_bitmap?.trim() || null;
    if (body.queries_bitmap !== undefined) ext.queries_bitmap = body.queries_bitmap?.trim() || null;
    if (body.feature_modules !== undefined) ext.feature_modules = body.feature_modules ?? [];
    if (body.capability_limits !== undefined) ext.capability_limits = body.capability_limits ?? {};
    if (body.resource_inventory !== undefined) ext.resource_inventory = body.resource_inventory ?? null;
    if (body.control_config !== undefined) ext.control_config = body.control_config ?? {};
    if (body.channel_bindings !== undefined) ext.channel_bindings = body.channel_bindings ?? [];
    if (body.runtime_rules !== undefined) ext.runtime_rules = body.runtime_rules ?? {};
    if (body.last_register_payload !== undefined) ext.last_register_payload = body.last_register_payload ?? null;
    if (body.auto_identified !== undefined) ext.auto_identified = body.auto_identified;
    if (body.imei !== undefined) {
      ext.comm_identity_type = normalizedImei ? 'imei' : null;
      ext.comm_identity_value = normalizedImei;
    }

    const created = await this.repo.insertDevice({
      tenantId: tid,
      deviceTypeId: typeId,
      regionId,
      deviceCode: body.device_code,
      deviceName: body.device_name,
      imei: normalizedImei,
      assetId,
      extPatch: ext
    });
    return this.getById(created.id);
  }

  async update(id: string, body: UpdateLedgerDeviceBody) {
    assertNoForbiddenSpatialWriteKeys(body as unknown as Record<string, unknown>);
    const tid = this.tenant();
    const existing = await this.repo.findById(tid, id);
    if (!existing) throw new NotFoundException('device not found');

    let deviceTypeId: string | undefined;
    const normalizedDeviceType =
      body.device_type === undefined ? undefined : body.device_type?.trim() || undefined;
    if (normalizedDeviceType !== undefined) {
      const resolved = await this.repo.resolveDeviceTypeId(tid, normalizedDeviceType);
      if (!resolved) throw new BadRequestException('device_type not found');
      deviceTypeId = resolved;
    }

    let regionId: string | undefined;
    let assetId: string | null | undefined;
    if (body.asset_id !== undefined) {
      assetId = body.asset_id?.trim() || null;
      if (assetId !== existing.asset_id) {
        if (assetId) {
          const resolvedRegionId = await this.repo.resolveRegionIdForAsset(tid, assetId);
          if (!resolvedRegionId) throw new BadRequestException('asset not found or region not resolvable');
          regionId = resolvedRegionId;
        }
      }
    }

    if (body.project_id !== undefined) {
      const projectId = body.project_id?.trim() || null;
      if (!assetId && projectId) {
        const resolvedRegionId = await this.repo.resolveRegionIdForProject(tid, projectId);
        if (!resolvedRegionId) throw new BadRequestException('project not found or region not resolvable');
        regionId = resolvedRegionId;
      }
    }

    const extMerge: Record<string, unknown> = {};
    const normalizedImei = body.imei?.trim() || null;
    if (body.project_id !== undefined) extMerge.project_id = body.project_id?.trim() || null;
    if (body.block_id !== undefined) extMerge.block_id = body.block_id?.trim() || null;
    if (body.source_module !== undefined) extMerge.source_module = body.source_module?.trim() || null;
    if (body.source_node_code !== undefined) extMerge.source_node_code = body.source_node_code?.trim() || null;
    if (body.source_unit_code !== undefined) extMerge.source_unit_code = body.source_unit_code?.trim() || null;
    if (body.manual_region_id !== undefined) extMerge.manual_region_id = body.manual_region_id;
    if (body.manual_address_text !== undefined) extMerge.manual_address_text = body.manual_address_text;
    if (body.manual_latitude !== undefined) extMerge.manual_latitude = body.manual_latitude;
    if (body.manual_longitude !== undefined) extMerge.manual_longitude = body.manual_longitude;
    if (body.install_position_desc !== undefined) extMerge.install_position_desc = body.install_position_desc;
    if (body.location_source_strategy !== undefined) extMerge.location_source_strategy = body.location_source_strategy;
    if (body.software_family !== undefined) extMerge.software_family = body.software_family?.trim() || null;
    if (body.software_version !== undefined) extMerge.software_version = body.software_version?.trim() || null;
    if (body.hardware_sku !== undefined) extMerge.hardware_sku = body.hardware_sku?.trim() || null;
    if (body.hardware_rev !== undefined) extMerge.hardware_rev = body.hardware_rev?.trim() || null;
    if (body.firmware_family !== undefined) extMerge.firmware_family = body.firmware_family?.trim() || null;
    if (body.meter_protocol !== undefined) extMerge.meter_protocol = body.meter_protocol?.trim() || null;
    if (body.control_protocol !== undefined) extMerge.control_protocol = body.control_protocol?.trim() || null;
    if (body.controller_role !== undefined) extMerge.controller_role = body.controller_role?.trim() || null;
    if (body.deployment_mode !== undefined) extMerge.deployment_mode = body.deployment_mode?.trim() || null;
    if (body.config_version !== undefined) extMerge.config_version = body.config_version;
    if (body.capability_version !== undefined) extMerge.capability_version = body.capability_version;
    if (body.capability_hash !== undefined) extMerge.capability_hash = body.capability_hash?.trim() || null;
    if (body.config_bitmap !== undefined) extMerge.config_bitmap = body.config_bitmap?.trim() || null;
    if (body.actions_bitmap !== undefined) extMerge.actions_bitmap = body.actions_bitmap?.trim() || null;
    if (body.queries_bitmap !== undefined) extMerge.queries_bitmap = body.queries_bitmap?.trim() || null;
    if (body.feature_modules !== undefined) extMerge.feature_modules = body.feature_modules ?? [];
    if (body.capability_limits !== undefined) extMerge.capability_limits = body.capability_limits ?? {};
    if (body.resource_inventory !== undefined) extMerge.resource_inventory = body.resource_inventory ?? null;
    if (body.control_config !== undefined) extMerge.control_config = body.control_config ?? {};
    if (body.channel_bindings !== undefined) extMerge.channel_bindings = body.channel_bindings ?? [];
    if (body.runtime_rules !== undefined) extMerge.runtime_rules = body.runtime_rules ?? {};
    if (body.last_register_payload !== undefined) extMerge.last_register_payload = body.last_register_payload ?? null;
    if (body.auto_identified !== undefined) extMerge.auto_identified = body.auto_identified;
    if (body.imei !== undefined) {
      extMerge.comm_identity_type = normalizedImei ? 'imei' : null;
      extMerge.comm_identity_value = normalizedImei;
    }

    await this.repo.updateDevice(tid, id, {
      deviceName: body.device_name,
      deviceTypeId,
      imei: body.imei !== undefined ? normalizedImei : undefined,
      assetId,
      regionId,
      extMerge
    });
    return this.getById(id);
  }

  async remove(id: string) {
    return this.archive(id, {
      archive_reason: 'manual_remove',
      reason_text: 'Archived from device ledger delete flow',
      trigger_type: 'manual_delete',
      source_module: 'device-ledger',
      source_action: 'DELETE /devices/:id',
      ui_entry: 'device_ledger.detail',
    });
  }

  async archive(id: string, body: ArchiveLedgerDeviceBody = {}) {
    const tenantId = this.tenant();
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) throw new NotFoundException('device not found');

    const releasedCode = buildReleasedArchivedDeviceCode(existing.device_code, existing.id);

    const archiveMeta = await this.db.withTransaction(async (client) => {
      const fresh = await this.repo.findById(tenantId, id, client);
      if (!fresh) {
        throw new NotFoundException('device not found');
      }

      const archiveResult = await this.archiveService.archiveDevice(
        {
          tenantId,
          originId: fresh.id,
          originCode: fresh.device_code,
          entityName: fresh.device_name,
          releasedCode,
          archiveReason: body.archive_reason?.trim() || 'manual_remove',
          reasonText: body.reason_text?.trim() || 'Archived from device ledger delete flow',
          triggerType: body.trigger_type?.trim() || 'manual_delete',
          sourceModule: body.source_module?.trim() || 'device-ledger',
          sourceAction: body.source_action?.trim() || 'DELETE /devices/:id',
          uiEntry: body.ui_entry?.trim() || 'device_ledger.detail',
          requestId: body.request_id?.trim() || null,
          batchId: body.batch_id?.trim() || null,
          operatorId: body.operator_id?.trim() || null,
          operatorName: body.operator_name?.trim() || null,
          snapshot: this.enrichLocation(fresh),
        },
        client,
      );

      const ok = await this.repo.archiveAndRelease(tenantId, id, releasedCode, client);
      if (!ok) throw new BadRequestException('device cannot be archived in current state');

      return archiveResult;
    });

    return { id, archive_id: archiveMeta.archiveId };
  }

  /**
   * Read-only display status aligned with `device-ledger.repository` list CASE
   * (`online` | `offline` | `alarm`). Not a persisted column.
   */
  displayStatusOptions() {
    return [
      { value: 'online', label: '在线' },
      { value: 'offline', label: '离线' },
      { value: 'alarm', label: '告警' }
    ];
  }

  /** Canonical keys for `ext_json.location_source_strategy` and asset defaults. */
  locationSourceStrategyOptions() {
    return [
      { value: 'manual_preferred', label: '优先使用人工位置' },
      { value: 'reported_preferred', label: '优先使用上报位置' },
      { value: 'manual_only', label: '仅使用人工位置' },
      { value: 'reported_only', label: '仅使用上报位置' },
      { value: 'auto', label: '自动（上报优先）' }
    ];
  }

  /** Canonical keys for `ext_json.comm_identity_type`. */
  commIdentityTypeOptions() {
    return [
      { value: 'imei', label: 'IMEI' },
      { value: 'iccid', label: 'ICCID' },
      { value: 'mac', label: 'MAC 地址' },
      { value: 'serial', label: '序列号' },
      { value: 'custom', label: '自定义' }
    ];
  }
}
