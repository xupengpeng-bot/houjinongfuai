import { Injectable } from '@nestjs/common';
import { DeviceEnvelope } from './device-envelope';
import { DeviceRuntimeEvent } from './device-runtime-event';

@Injectable()
export class TcpJsonV1Adapter {
  private readonly compactMessageTypeMap: Record<string, string> = {
    RG: 'REGISTER',
    HB: 'HEARTBEAT',
    SS: 'STATE_SNAPSHOT',
    ER: 'EVENT_REPORT',
    QR: 'QUERY',
    QS: 'QUERY_RESULT',
    EX: 'EXECUTE_ACTION',
    SC: 'SYNC_CONFIG',
    RA: 'REGISTER_ACK',
    RN: 'REGISTER_NACK',
    AK: 'COMMAND_ACK',
    NK: 'COMMAND_NACK',
  };

  private readonly compactWorkflowStateMap: Record<string, string> = {
    BR: 'BOOTING',
    NR: 'ONLINE_NOT_READY',
    RI: 'READY_IDLE',
    ST: 'STARTING',
    RN: 'RUNNING',
    PA: 'PAUSING',
    PS: 'PAUSED',
    RS: 'RESUMING',
    SP: 'STOPPING',
    ED: 'STOPPED',
    ER: 'ERROR_STOP',
  };

  private readonly compactModuleCodeMap: Record<string, string> = {
    pvc: 'pump_vfd_control',
    pdc: 'pump_direct_control',
    rly: 'relay_output_control',
    svl: 'single_valve_control',
    dvl: 'dual_valve_control',
    ebr: 'electric_meter_modbus',
    bkr: 'breaker_control',
    bkf: 'breaker_feedback_monitor',
    prs: 'pressure_acquisition',
    flw: 'flow_acquisition',
    sma: 'soil_moisture_acquisition',
    sta: 'soil_temperature_acquisition',
    pwm: 'power_monitoring',
    pay: 'payment_qr_control',
    cdr: 'card_auth_reader',
    vfb: 'valve_feedback_monitor',
    rsg: 'rs485_sensor_gateway',
    rvg: 'rs485_vfd_gateway',
  };

  private readonly compactMetricCodeMap: Record<string, string> = {
    pr: 'pressure_mpa',
    fm: 'flow_m3h',
    pw: 'power_kw',
    vv: 'voltage_v',
    ia: 'current_a',
    ew: 'energy_wh',
    ek: 'energy_kwh',
    fq: 'total_m3',
    rt: 'runtime_sec',
    bs: 'battery_soc',
    bv: 'battery_voltage_v',
    sv: 'solar_voltage_v',
    csq: 'signal_csq',
    brs: 'breaker_state',
    mp: 'meter_protocol',
    cp: 'control_protocol',
  };

  private readonly compactScopeMap: Record<string, string> = {
    cm: 'common',
    md: 'module',
    wf: 'workflow',
  };

  private readonly compactActionCodeMap: Record<string, string> = {
    ppu: 'play_voice_prompt',
    upg: 'upgrade_firmware',
    pas: 'pause_session',
    res: 'resume_session',
    spu: 'start_pump',
    tpu: 'stop_pump',
    orl: 'open_relay',
    crl: 'close_relay',
    ovl: 'open_valve',
    cvl: 'close_valve',
  };

  private readonly compactQueryCodeMap: Record<string, string> = {
    qcs: 'query_common_status',
    qwf: 'query_workflow_state',
    qms: 'query_module_status',
    qcv: 'query_channel_values',
    qps: 'query_power_status',
    qem: 'query_electric_meter',
    qgs: 'query_upgrade_status',
    qgc: 'query_upgrade_capability',
  };

  private readonly compactRejectCodeMap: Record<string, string> = {
    BZ: 'device_busy',
    UC: 'unsupported_command',
    IC: 'invalid_channel',
    CD: 'channel_disabled',
    MN: 'module_not_enabled',
    CE: 'capability_not_exposed',
    SI: 'safety_interlock',
    LB: 'low_battery',
    PR: 'power_not_ready',
    SR: 'sensor_required',
    PI: 'param_invalid',
    CV: 'config_version_mismatch',
    EX: 'expired_command',
  };

  private readonly compactProtocolKindMap: Record<string, string> = {
    dlt645_2007: 'dlt645_2007',
    dlt645: 'dlt645_2007',
    'dlt/645-2007': 'dlt645_2007',
    modbus_rtu: 'modbus_rtu',
    modbus: 'modbus_rtu',
    relay_direct: 'relay_direct',
    unknown: 'unknown',
  };

  private readonly compactBreakerStateMap: Record<string, string> = {
    closed: 'closed',
    close: 'closed',
    on: 'closed',
    opened: 'opened',
    open: 'opened',
    off: 'opened',
    tripped: 'tripped',
    trip: 'tripped',
    unknown: 'unknown',
  };

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asBoolean(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
    }
    return false;
  }

  private asStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.map((item) => this.asString(item)).filter((item) => Boolean(item))
      : [];
  }

  private normalizeTimestampToken(value: unknown) {
    const normalized = this.asString(value);
    if (!normalized) return '';
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
  }

  private normalizeFromMap(value: unknown, dictionary: Record<string, string>, mode: 'lower' | 'upper' = 'lower') {
    const normalized = this.asString(value);
    if (!normalized) return '';
    const key = mode === 'upper' ? normalized.toUpperCase() : normalized.toLowerCase();
    return dictionary[key] ?? normalized;
  }

  private normalizeMsgType(value: unknown) {
    return this.normalizeFromMap(value, this.compactMessageTypeMap, 'upper') || this.asString(value).toUpperCase();
  }

  private normalizeWorkflowState(value: unknown) {
    return this.normalizeFromMap(value, this.compactWorkflowStateMap, 'upper');
  }

  private normalizeModuleCode(value: unknown) {
    return this.normalizeFromMap(value, this.compactModuleCodeMap) || this.asString(value);
  }

  private normalizeMetricCode(value: unknown) {
    return this.normalizeFromMap(value, this.compactMetricCodeMap) || this.asString(value);
  }

  private normalizeScope(value: unknown) {
    return this.normalizeFromMap(value, this.compactScopeMap) || this.asString(value);
  }

  private normalizeActionCode(value: unknown) {
    return this.normalizeFromMap(value, this.compactActionCodeMap) || this.asString(value);
  }

  private normalizeQueryCode(value: unknown) {
    return this.normalizeFromMap(value, this.compactQueryCodeMap) || this.asString(value);
  }

  private normalizeRejectCode(value: unknown) {
    return this.normalizeFromMap(value, this.compactRejectCodeMap, 'upper') || this.asString(value);
  }

  private normalizeProtocolKind(value: unknown) {
    return this.normalizeFromMap(value, this.compactProtocolKindMap) || this.asString(value).toLowerCase();
  }

  private normalizeBreakerState(value: unknown) {
    return this.normalizeFromMap(value, this.compactBreakerStateMap) || this.asString(value).toLowerCase();
  }

  private normalizeQuality(value: unknown) {
    const numeric = this.asNumber(value);
    if (numeric !== null) {
      return numeric > 0 ? 'good' : 'bad';
    }
    return this.asString(value).toLowerCase() || 'good';
  }

  private metricValue(value: unknown) {
    if (Array.isArray(value)) return null;
    if (value && typeof value === 'object') return null;
    return this.asNumber(value);
  }

  private inferModuleCodeFromMetric(metricCode: string, featureModules: string[]) {
    if (['voltage_v', 'current_a', 'power_kw', 'energy_kwh', 'meter_protocol'].includes(metricCode)) {
      if (featureModules.includes('electric_meter_modbus')) return 'electric_meter_modbus';
      if (featureModules.includes('power_monitoring')) return 'power_monitoring';
    }
    if (['breaker_state', 'control_protocol'].includes(metricCode)) {
      if (featureModules.includes('breaker_feedback_monitor')) return 'breaker_feedback_monitor';
      if (featureModules.includes('breaker_control')) return 'breaker_control';
    }
    if (metricCode === 'pressure_mpa' && featureModules.includes('pressure_acquisition')) {
      return 'pressure_acquisition';
    }
    if (['flow_m3h', 'total_m3'].includes(metricCode) && featureModules.includes('flow_acquisition')) {
      return 'flow_acquisition';
    }
    if (metricCode === 'runtime_sec') {
      if (featureModules.includes('pump_direct_control')) return 'pump_direct_control';
      if (featureModules.includes('pump_vfd_control')) return 'pump_vfd_control';
    }
    return featureModules[0] || 'common_status';
  }

  private normalizeFeatureModules(value: unknown) {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeModuleCode(item)).filter((item) => Boolean(item));
    }

    if (typeof value === 'string' && value.trim()) {
      if (this.asNumber(value) !== null) return [];
      return value
        .split(',')
        .map((item) => this.normalizeModuleCode(item))
        .filter((item) => Boolean(item));
    }

    const source = this.asObject(value);
    return Object.entries(source)
      .filter(([, enabled]) => this.asBoolean(enabled))
      .map(([moduleCode]) => this.normalizeModuleCode(moduleCode))
      .filter((item) => Boolean(item));
  }

  private normalizeChannels(payload: Record<string, unknown>, featureModules: string[]) {
    const source = payload.channels ?? payload.channelValues ?? payload.ch;
    if (!Array.isArray(source)) return [];

    const rows: Record<string, unknown>[] = [];
    for (const item of source) {
      const channel = this.asObject(item);
      if (Object.keys(channel).length === 0) continue;

      const metricCode =
        this.normalizeMetricCode(channel.metric_code ?? channel.metricCode ?? channel.mr) || undefined;
      const moduleCode =
        this.normalizeModuleCode(channel.module_code ?? channel.moduleCode ?? channel.mc) ||
        this.inferModuleCodeFromMetric(metricCode ?? '', featureModules);
      const channelCode =
        this.asString(channel.channel_code ?? channel.channelCode ?? channel.cc) ||
        metricCode ||
        'value';
      const valueNum = this.asNumber(channel.value ?? channel.v);
      const valueText = valueNum === null ? this.asString(channel.value ?? channel.v) : '';
      const state = this.asString(channel.state ?? channel.st);

      rows.push({
        module_code: moduleCode,
        module_instance_code: this.asString(channel.module_instance_code ?? channel.moduleInstanceCode ?? channel.mi) || null,
        channel_code: channelCode,
        channel_role: this.asString(channel.channel_role ?? channel.channelRole ?? channel.cr) || null,
        io_kind: this.asString(channel.io_kind ?? channel.ioKind ?? channel.ir) || null,
        metric_code: metricCode ?? null,
        enabled:
          channel.enabled !== undefined || channel.en !== undefined
            ? this.asBoolean(channel.enabled ?? channel.en)
            : true,
        state: state || null,
        value: valueNum ?? (valueText || null),
        unit: this.asString(channel.unit ?? channel.u) || null,
        quality: this.normalizeQuality(channel.quality ?? channel.q),
        fault_codes: this.asStringArray(channel.fault_codes ?? channel.faultCodes),
      });
    }

    return rows;
  }

  private normalizeChannelValues(payload: Record<string, unknown>, featureModules: string[]) {
    const source = payload.channel_values ?? payload.channelValues;
    const fromChannelValues = Array.isArray(source) ? source : [];

    const rows: Record<string, unknown>[] = [];
    for (const item of fromChannelValues) {
      const channel = this.asObject(item);
      if (Object.keys(channel).length === 0) continue;

      const metricCode = this.normalizeMetricCode(channel.metric_code ?? channel.metricCode ?? channel.mr) || 'value';
      const normalizedValue = this.asNumber(channel.value ?? channel.v);
      const normalizedText = normalizedValue === null ? this.asString(channel.value ?? channel.v) : '';
      if (normalizedValue === null && !normalizedText) continue;

      rows.push({
        module_code:
          this.normalizeModuleCode(channel.module_code ?? channel.moduleCode ?? channel.mc) ||
          this.inferModuleCodeFromMetric(metricCode, featureModules),
        channel_code: this.asString(channel.channel_code ?? channel.channelCode ?? channel.cc) || metricCode,
        metric_code: metricCode,
        value: normalizedValue ?? normalizedText,
        unit: this.asString(channel.unit ?? channel.u) || null,
        quality: this.normalizeQuality(channel.quality ?? channel.q),
      });
    }

    return rows;
  }

  private buildSyntheticMetricChannelValues(payload: Record<string, unknown>, featureModules: string[]) {
    const metricEntries: Array<{
      metricCode: string;
      values: unknown[];
      channelCode: string;
    }> = [
      { metricCode: 'voltage_v', values: [payload.voltage_v, payload.voltageV, payload.vv], channelCode: 'meter_voltage' },
      { metricCode: 'current_a', values: [payload.current_a, payload.currentA, payload.ia], channelCode: 'meter_current' },
      { metricCode: 'power_kw', values: [payload.power_kw, payload.powerKw, payload.pw], channelCode: 'meter_power' },
      { metricCode: 'energy_kwh', values: [payload.energy_kwh, payload.energyKwh, payload.ek], channelCode: 'meter_energy' },
      { metricCode: 'pressure_mpa', values: [payload.pressure_mpa, payload.pressureMpa, payload.pr], channelCode: 'pressure_snapshot' },
      { metricCode: 'flow_m3h', values: [payload.flow_m3h, payload.flowM3h, payload.fm], channelCode: 'flow_snapshot' },
      { metricCode: 'total_m3', values: [payload.total_m3, payload.totalM3, payload.fq], channelCode: 'flow_total' },
      { metricCode: 'runtime_sec', values: [payload.runtime_sec, payload.runtimeSec, payload.rt], channelCode: 'runtime_total' },
      { metricCode: 'breaker_state', values: [payload.breaker_state, payload.breakerState, payload.brs], channelCode: 'breaker_state' },
      { metricCode: 'meter_protocol', values: [payload.meter_protocol, payload.meterProtocol, payload.mp], channelCode: 'meter_protocol' },
      { metricCode: 'control_protocol', values: [payload.control_protocol, payload.controlProtocol, payload.cp], channelCode: 'control_protocol' },
    ];

    return metricEntries.flatMap((entry) => {
      const value = entry.values.find((item) => {
        if (item === null || item === undefined) return false;
        if (typeof item === 'string') return item.trim().length > 0;
        if (typeof item === 'number') return Number.isFinite(item);
        return false;
      });
      if (value === undefined) return [];

      const normalizedValue =
        entry.metricCode === 'breaker_state'
          ? this.normalizeBreakerState(value)
          : ['meter_protocol', 'control_protocol'].includes(entry.metricCode)
            ? this.normalizeProtocolKind(value)
            : value;
      const numericValue = this.asNumber(normalizedValue);

      return [
        {
          module_code: this.inferModuleCodeFromMetric(entry.metricCode, featureModules),
          channel_code: entry.channelCode,
          metric_code: entry.metricCode,
          value: numericValue ?? normalizedValue,
          unit:
            entry.metricCode === 'energy_kwh'
              ? 'kWh'
              : entry.metricCode === 'power_kw'
                ? 'kW'
                : entry.metricCode === 'current_a'
                  ? 'A'
                  : entry.metricCode === 'voltage_v'
                    ? 'V'
                    : entry.metricCode === 'pressure_mpa'
                      ? 'MPa'
                      : entry.metricCode === 'flow_m3h'
                        ? 'm3/h'
                        : entry.metricCode === 'total_m3'
                          ? 'm3'
                          : entry.metricCode === 'runtime_sec'
                            ? 's'
                            : null,
          quality: 'good',
        },
      ];
    });
  }

  private normalizePayload(envelope: DeviceEnvelope) {
    const source = this.asObject(envelope.payload);
    const payload: Record<string, unknown> = { ...source };
    const identity = this.asObject(source.identity);
    const normalizedIdentity: Record<string, unknown> = { ...identity };

    const configVersion = this.asNumber(source.config_version ?? source.configVersion ?? source.cv);
    const heartbeatReady = source.ready ?? source.rd;
    const compactPowerMode = source.pm && typeof source.pm === 'object' ? undefined : source.pm;
    const workflowState = this.normalizeWorkflowState(source.workflow_state ?? source.workflowState ?? source.wf);
    const actionCode = this.normalizeActionCode(source.action_code ?? source.actionCode ?? source.ac);
    const queryCode = this.normalizeQueryCode(source.query_code ?? source.queryCode ?? source.qc);
    const rejectCode = this.normalizeRejectCode(source.reject_code ?? source.rejectCode ?? source.rc);
    const featureModules =
      source.feature_modules === undefined && source.featureModules === undefined
        ? this.normalizeFeatureModules(source.fm)
        : this.normalizeFeatureModules(source.feature_modules ?? source.featureModules);
    const capabilityVersion = this.asNumber(
      source.capability_version ?? source.capabilityVersion ?? source.cap_ver
    );
    const capabilityHash = this.asString(
      source.capability_hash ?? source.capabilityHash ?? source.cap_hash
    );
    const configBitmap = this.asString(source.config_bitmap ?? source.configBitmap);
    const actionsBitmap = this.asString(source.actions_bitmap ?? source.actionsBitmap);
    const queriesBitmap = this.asString(source.queries_bitmap ?? source.queriesBitmap);
    const capabilityLimits = this.asObject(source.limits ?? source.capability_limits ?? source.capabilityLimits);
    const resourceInventory = this.asObject(source.resource_inventory ?? source.resourceInventory ?? source.ri);
    const meterProtocol = this.normalizeProtocolKind(source.meter_protocol ?? source.meterProtocol ?? source.mp);
    const controlProtocol = this.normalizeProtocolKind(source.control_protocol ?? source.controlProtocol ?? source.cp);
    const breakerState = this.normalizeBreakerState(source.breaker_state ?? source.breakerState ?? source.brs);
    const eventCode = this.asString(source.event_code ?? source.eventCode ?? source.ec);
    const stage = this.asString(source.stage ?? source.stg);
    const result = this.asString(
      source.result ?? source.status ?? source.command_status ?? source.commandStatus ?? source.res
    );
    const progressPercent = this.asNumber(source.progress_percent ?? source.progressPercent ?? source.pp);
    const upgradeToken = this.asString(source.upgrade_token ?? source.upgradeToken ?? source.ut);
    const message = source.message ?? source.msg;
    const checksum = source.checksum ?? source.package_checksum ?? source.packageChecksum ?? source.sum;

    const commonStatus: Record<string, unknown> = {};
    if (heartbeatReady !== undefined) commonStatus.ready = this.asBoolean(heartbeatReady);
    if (source.online !== undefined || source.on !== undefined) commonStatus.online = this.asBoolean(source.online ?? source.on);
    if (source.tcp_connected !== undefined || source.tcpConnected !== undefined || source.tc !== undefined) {
      commonStatus.tcp_connected = this.asBoolean(source.tcp_connected ?? source.tcpConnected ?? source.tc);
    }
    if (configVersion !== null) commonStatus.config_version = configVersion;
    if (capabilityVersion !== null) commonStatus.capability_version = capabilityVersion;
    if (capabilityHash) commonStatus.capability_hash = capabilityHash;

    const signalCsq = this.asNumber(source.signal_csq ?? source.signalCsq ?? source.csq);
    if (signalCsq !== null) commonStatus.signal_csq = signalCsq;

    const batterySoc = this.asNumber(source.battery_soc ?? source.batterySoc ?? source.bs);
    if (batterySoc !== null) commonStatus.battery_soc = batterySoc;

    const batteryVoltage = this.asNumber(source.battery_voltage ?? source.batteryVoltage ?? source.battery_voltage_v ?? source.bv);
    if (batteryVoltage !== null) commonStatus.battery_voltage = batteryVoltage;

    const solarVoltage = this.asNumber(source.solar_voltage ?? source.solarVoltage ?? source.solar_voltage_v ?? source.sv);
    if (solarVoltage !== null) commonStatus.solar_voltage = solarVoltage;

    if (compactPowerMode !== undefined || source.power_mode !== undefined || source.powerMode !== undefined) {
      commonStatus.power_mode = source.power_mode ?? source.powerMode ?? compactPowerMode;
    }
    if (meterProtocol) commonStatus.meter_protocol = meterProtocol;
    if (controlProtocol) commonStatus.control_protocol = controlProtocol;
    if (breakerState) commonStatus.breaker_state = breakerState;

    const uptimeSec = this.asNumber(source.uptime_sec ?? source.uptimeSec);
    if (uptimeSec !== null) commonStatus.uptime_sec = uptimeSec;

    const controllerState: Record<string, unknown> = {};
    if (workflowState) controllerState.workflow_state = workflowState;
    if (source.registered_once !== undefined || source.registeredOnce !== undefined) {
      controllerState.registered_once = this.asBoolean(source.registered_once ?? source.registeredOnce);
    }
    if (source.run_state !== undefined || source.runState !== undefined) {
      controllerState.run_state = source.run_state ?? source.runState;
    }
    if (source.power_state !== undefined || source.powerState !== undefined) {
      controllerState.power_state = source.power_state ?? source.powerState;
    }

    const normalizedChannels = this.normalizeChannels(source, featureModules);
    const channelValues = [
      ...this.normalizeChannelValues(source, featureModules),
      ...this.buildSyntheticMetricChannelValues(source, featureModules),
    ];

    if (source.iccid !== undefined) normalizedIdentity.iccid = source.iccid;
    if (source.hardware_sku !== undefined || source.hardwareSku !== undefined || source.hs !== undefined) {
      normalizedIdentity.hardware_sku = source.hardware_sku ?? source.hardwareSku ?? source.hs;
    }
    if (source.hardware_rev !== undefined || source.hardwareRev !== undefined || source.hr !== undefined) {
      normalizedIdentity.hardware_rev = source.hardware_rev ?? source.hardwareRev ?? source.hr;
    }
    if (source.firmware_family !== undefined || source.firmwareFamily !== undefined || source.ff !== undefined) {
      normalizedIdentity.firmware_family = source.firmware_family ?? source.firmwareFamily ?? source.ff;
    }
    if (source.firmware_version !== undefined || source.firmwareVersion !== undefined || source.fv !== undefined) {
      normalizedIdentity.firmware_version = source.firmware_version ?? source.firmwareVersion ?? source.fv;
    }

    if (Object.keys(normalizedIdentity).length > 0) {
      payload.identity = normalizedIdentity;
      if (payload.hardware_sku === undefined && normalizedIdentity.hardware_sku !== undefined) {
        payload.hardware_sku = normalizedIdentity.hardware_sku;
      }
      if (payload.hardware_rev === undefined && normalizedIdentity.hardware_rev !== undefined) {
        payload.hardware_rev = normalizedIdentity.hardware_rev;
      }
      if (payload.firmware_family === undefined && normalizedIdentity.firmware_family !== undefined) {
        payload.firmware_family = normalizedIdentity.firmware_family;
      }
      if (payload.firmware_version === undefined && normalizedIdentity.firmware_version !== undefined) {
        payload.firmware_version = normalizedIdentity.firmware_version;
      }
    }

    if (featureModules.length > 0) {
      payload.feature_modules = featureModules;
    }
    if (Object.keys(commonStatus).length > 0) {
      payload.common_status = commonStatus;
    }
    if (Object.keys(controllerState).length > 0) {
      payload.controller_state = controllerState;
    }
    if (channelValues.length > 0) {
      payload.channel_values = channelValues;
    }
    if (normalizedChannels.length > 0) {
      payload.channels = normalizedChannels;
    }

    if (configVersion !== null && payload.config_version === undefined) {
      payload.config_version = configVersion;
    }
    if (capabilityVersion !== null && payload.capability_version === undefined) {
      payload.capability_version = capabilityVersion;
    }
    if (capabilityHash && payload.capability_hash === undefined) {
      payload.capability_hash = capabilityHash;
    }
    if (configBitmap && payload.config_bitmap === undefined) {
      payload.config_bitmap = configBitmap;
    }
    if (actionsBitmap && payload.actions_bitmap === undefined) {
      payload.actions_bitmap = actionsBitmap;
    }
    if (queriesBitmap && payload.queries_bitmap === undefined) {
      payload.queries_bitmap = queriesBitmap;
    }
    if (Object.keys(capabilityLimits).length > 0 && payload.limits === undefined) {
      payload.limits = capabilityLimits;
    }
    if (Object.keys(resourceInventory).length > 0 && payload.resource_inventory === undefined) {
      payload.resource_inventory = resourceInventory;
    }
    if (meterProtocol && payload.meter_protocol === undefined) {
      payload.meter_protocol = meterProtocol;
    }
    if (controlProtocol && payload.control_protocol === undefined) {
      payload.control_protocol = controlProtocol;
    }
    if (breakerState && payload.breaker_state === undefined) {
      payload.breaker_state = breakerState;
    }
    if (eventCode && payload.event_code === undefined) {
      payload.event_code = eventCode;
    }
    if (workflowState) {
      payload.workflow_state = workflowState;
    }
    if (actionCode) {
      payload.action_code = actionCode;
    }
    if (queryCode) {
      payload.query_code = queryCode;
    }
    if (rejectCode) {
      payload.reject_code = rejectCode;
      if (payload.reason_code === undefined) {
        payload.reason_code = rejectCode;
      }
    }
    if (stage && payload.stage === undefined) {
      payload.stage = stage;
    }
    if (result && payload.result === undefined) {
      payload.result = result;
    }
    if (progressPercent !== null && payload.progress_percent === undefined) {
      payload.progress_percent = progressPercent;
    }
    if (upgradeToken && payload.upgrade_token === undefined) {
      payload.upgrade_token = upgradeToken;
    }
    if (message !== undefined && payload.message === undefined) {
      payload.message = message;
    }
    if (checksum !== undefined && payload.checksum === undefined) {
      payload.checksum = checksum;
    }
    if (payload.scope === undefined && source.sc !== undefined) {
      payload.scope = this.normalizeScope(source.sc);
    }
    if (payload.target_ref === undefined && source.tr !== undefined) {
      payload.target_ref = source.tr;
    }
    if (payload.params === undefined && source.pm && typeof source.pm === 'object' && !Array.isArray(source.pm)) {
      payload.params = this.asObject(source.pm);
    }

    return payload;
  }

  private resolveEventType(msgType: string, payload: Record<string, unknown>): DeviceRuntimeEvent['eventType'] {
    const normalizedMsgType = this.normalizeMsgType(msgType);
    const queryCode = this.normalizeQueryCode(payload.query_code ?? payload.queryCode ?? payload.qc).toLowerCase();
    const eventCode = this.asString(payload.event_code ?? payload.eventCode).toLowerCase();
    const rejectCode = this.normalizeRejectCode(payload.reject_code ?? payload.rejectCode ?? payload.rc).toLowerCase();
    const result = this.asString(payload.result ?? payload.status ?? payload.command_status ?? payload.commandStatus).toLowerCase();

    if (normalizedMsgType === 'REGISTER') return 'DEVICE_REGISTERED';
    if (normalizedMsgType === 'HEARTBEAT') return 'DEVICE_HEARTBEAT';
    if (normalizedMsgType === 'STATE_SNAPSHOT') return 'DEVICE_STATE_SNAPSHOT';
    if (normalizedMsgType === 'QUERY') {
      if (queryCode === 'card_swipe' || eventCode === 'card_swipe_requested') return 'DEVICE_CARD_SWIPE_REQUESTED';
      return 'DEVICE_QUERY_RESULT';
    }
    if (normalizedMsgType === 'QUERY_RESULT') return 'DEVICE_QUERY_RESULT';
    if (normalizedMsgType === 'COMMAND_ACK') {
      return result === 'rejected' || result === 'failed' || result === 'blocked' || rejectCode !== ''
        ? 'DEVICE_COMMAND_NACKED'
        : 'DEVICE_COMMAND_ACKED';
    }
    if (normalizedMsgType === 'COMMAND_NACK') return 'DEVICE_COMMAND_NACKED';
    if (normalizedMsgType === 'EVENT_REPORT') {
      if (eventCode === 'card_swipe_requested') return 'DEVICE_CARD_SWIPE_REQUESTED';
      if (this.isAcceptedPlatformCheckoutCardSwipeEvent(payload)) return 'DEVICE_CARD_SWIPE_REQUESTED';
      if (eventCode === 'card_swipe_rejected') return 'DEVICE_CARD_SWIPE_REJECTED';
      if (eventCode === 'runtime_stopped' || eventCode === 'device_runtime_stopped') return 'DEVICE_RUNTIME_STOPPED';
      if (eventCode === 'alarm' || eventCode === 'device_alarm_raised') return 'DEVICE_ALARM_RAISED';
      if (eventCode === 'runtime_tick') return 'DEVICE_RUNTIME_TICK';
      return 'DEVICE_STATE_SNAPSHOT';
    }
    return 'DEVICE_RUNTIME_TICK';
  }

  private isAcceptedPlatformCheckoutCardSwipeEvent(payload: Record<string, unknown>) {
    const eventCode = this.asString(payload.event_code ?? payload.eventCode ?? payload.ec).toLowerCase();
    if (eventCode !== 'cse') {
      return false;
    }

    const reasonCode = this.normalizeRejectCode(
      payload.reason_code ?? payload.reasonCode ?? payload.reject_code ?? payload.rejectCode ?? payload.rc
    ).toLowerCase();
    const rawMessage = this.asString(payload.message ?? payload.msg);
    const auditOutcome = this.asString(rawMessage.split('|', 1)[0] ?? payload.result ?? payload.status).toLowerCase();

    return reasonCode === 'platform_checkout' && auditOutcome === 'accepted';
  }

  toRuntimeEvent(envelope: DeviceEnvelope): DeviceRuntimeEvent {
    const normalizedMsgType = this.normalizeMsgType(envelope.msgType);
    const payload = this.normalizePayload({
      ...envelope,
      msgType: normalizedMsgType,
    });
    const runtimeSec =
      this.asNumber(payload.runtime_sec ?? payload.runtimeSec ?? payload.rt) ??
      envelope.cumulativeRuntimeSec ??
      null;

    const cumulativeEnergyWhFromPayload = this.asNumber(payload.cumulative_energy_wh ?? payload.energy_wh ?? payload.energyWh ?? payload.ew);
    const cumulativeEnergyKwhFromPayload = this.asNumber(
      payload.cumulative_energy_kwh ?? payload.energy_kwh ?? payload.energyKwh ?? payload.ek
    );
    const energyWh =
      cumulativeEnergyWhFromPayload ??
      (cumulativeEnergyKwhFromPayload === null ? null : cumulativeEnergyKwhFromPayload * 1000) ??
      envelope.cumulativeEnergyWh ??
      null;

    const flow =
      this.asNumber(payload.cumulative_flow ?? payload.total_m3 ?? payload.totalM3 ?? payload.flow_total ?? payload.flowTotal ?? payload.fq) ??
      envelope.cumulativeFlow ??
      null;

    const commandId =
      envelope.correlationId ??
      (this.asString(payload.command_id ?? payload.commandId) || null);

    const msgIdToken = envelope.msgId ? `msg:${envelope.msgId}` : 'msg:none';
    const msgTypeToken = `type:${normalizedMsgType}`;
    const deviceTsToken = this.normalizeTimestampToken(envelope.deviceTs);
    const seqToken = envelope.seqNo === null || envelope.seqNo === undefined ? 'seq:none' : `seq:${envelope.seqNo}`;
    const dedupeClockToken = deviceTsToken ? `deviceTs:${deviceTsToken}` : seqToken;

    return {
      eventType: this.resolveEventType(normalizedMsgType, payload),
      imei: envelope.imei,
      msgId: envelope.msgId,
      seqNo: envelope.seqNo,
      msgType: normalizedMsgType,
      deviceTs: envelope.deviceTs,
      serverRxTs: envelope.serverRxTs,
      sessionRef:
        envelope.sessionRef ??
        (this.asString(payload.session_ref ?? payload.sessionRef ?? payload.session_id ?? payload.sessionId) || null),
      commandId,
      startToken: this.asString(payload.start_token ?? payload.startToken) || null,
      counters: {
        runtimeSec,
        energyWh,
        flow,
      },
      payload,
      idempotencyKey: `${envelope.imei}:${msgTypeToken}:${msgIdToken}:${dedupeClockToken}`,
      orderingKey: `${envelope.imei}:${envelope.seqNo}`,
      clockDriftSec: null,
    };
  }
}
