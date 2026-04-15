import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DeviceEnvelope } from '../protocol-adapter/device-envelope';
import { DeviceRuntimeEvent } from '../protocol-adapter/device-runtime-event';
import {
  ChannelLatestUpsertInput,
  ChannelLatestRow,
  DeviceHealthDailyRow,
  OfflineEventRow,
  RebootEventRow,
  RuntimeConnectionStateUpsertInput,
  RuntimeIngestRepository,
  RuntimeStatusRow,
  RuntimeShadowRow,
  RuntimeShadowUpsertInput,
} from './runtime-ingest.repository';
import { resolveRuntimeShadowWorkflowState } from './runtime-shadow-state';

type RuntimeDeviceRef = {
  id: string;
  imei: string;
  projectId?: string | null;
  blockId?: string | null;
  sourceNodeCode?: string | null;
};

type RuntimeHealthSnapshot = {
  runtimeStatus: RuntimeStatusRow | null;
  latestOfflineEvent: OfflineEventRow | null;
  today: DeviceHealthDailyRow | null;
  recentRebootEvents: RebootEventRow[];
};

@Injectable()
export class RuntimeIngestService {
  constructor(private readonly repository: RuntimeIngestRepository) {}

  getMode() {
    return 'active';
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

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

  private asInteger(value: unknown) {
    const parsed = this.asNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
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

  private toIsoTimestamp(value: unknown) {
    const normalized = this.asString(value);
    if (!normalized) return null;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private toUuidOrNull(value: unknown) {
    const normalized = this.asString(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized) ? normalized : null;
  }

  private addSeconds(baseIso: string, seconds: number) {
    const base = new Date(baseIso);
    if (Number.isNaN(base.getTime())) return null;
    return new Date(base.getTime() + seconds * 1000).toISOString();
  }

  private diffSeconds(startIso: string | null | undefined, endIso: string | null | undefined) {
    const start = this.toIsoTimestamp(startIso);
    const end = this.toIsoTimestamp(endIso);
    if (!start || !end) return null;
    const deltaMs = new Date(end).getTime() - new Date(start).getTime();
    if (!Number.isFinite(deltaMs)) return null;
    return Math.max(0, Math.floor(deltaMs / 1000));
  }

  private dayKey(value: string | null | undefined) {
    const normalized = this.toIsoTimestamp(value);
    if (!normalized) return new Date().toISOString().slice(0, 10);
    return normalized.slice(0, 10);
  }

  private getTodayDefault(day: string, imei: string, tenantId: string, deviceId: string): DeviceHealthDailyRow {
    return {
      tenantId,
      deviceId,
      day,
      imei,
      offlineCount: 0,
      offlineTotalSec: 0,
      availability: 1,
      registerCount: 0,
      rebootCount: 0,
      peerCloseSuspectCount: 0,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
  }

  private distributeDurationByDay(startIso: string, endIso: string) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];

    const segments: Array<{ day: string; durationSec: number }> = [];
    let cursor = start;
    while (cursor < end) {
      const nextDay = new Date(cursor);
      nextDay.setUTCHours(24, 0, 0, 0);
      const segmentEnd = nextDay < end ? nextDay : end;
      const durationSec = Math.max(0, Math.floor((segmentEnd.getTime() - cursor.getTime()) / 1000));
      if (durationSec > 0) {
        segments.push({
          day: cursor.toISOString().slice(0, 10),
          durationSec
        });
      }
      cursor = segmentEnd;
    }
    return segments;
  }

  private isPeerCloseReason(reason: string | null | undefined) {
    const normalized = this.asString(reason).toLowerCase();
    return normalized === 'peer_closed' || normalized === 'modem_closed';
  }

  private buildHealthFlags(input: {
    registerAlertLevel?: string | null;
    frequentRebootRecoveryStreak?: number | null;
    peerCloseSuspectStreak?: number | null;
  }) {
    const flags: string[] = [];
    const registerLevel = this.asString(input.registerAlertLevel).toLowerCase();
    if (registerLevel === 'warning') {
      flags.push('register_storm_warning');
    }
    if (registerLevel === 'critical') {
      flags.push('register_storm_critical');
    }
    if ((input.frequentRebootRecoveryStreak ?? 0) >= 3) {
      flags.push('suspected_power_reboot_flapping');
    }
    if ((input.peerCloseSuspectStreak ?? 0) >= 3) {
      flags.push('peer_closed_link_risk');
    }
    return flags;
  }

  private computeRegisterAlertLevel(registerCountLastHour: number) {
    if (registerCountLastHour > 10) return 'critical';
    if (registerCountLastHour > 3) return 'warning';
    return null;
  }

  private extractStatusMetrics(payload: Record<string, unknown>) {
    const commonStatus = this.asObject(payload.common_status ?? payload.commonStatus);
    const identity = this.asObject(payload.identity);
    const eventCode = this.asString(payload.event_code ?? payload.eventCode).toLowerCase();

    return {
      eventCode,
      bootSessionId:
        this.asString(payload.boot_session_id ?? payload.bootSessionId) ||
        this.asString(commonStatus.boot_session_id ?? commonStatus.bootSessionId) ||
        null,
      uptimeSec:
        this.asInteger(payload.uptime_sec ?? payload.uptimeSec ?? commonStatus.uptime_sec ?? commonStatus.uptimeSec),
      resetCause:
        this.asString(payload.reset_cause ?? payload.resetCause) ||
        this.asString(commonStatus.reset_cause ?? commonStatus.resetCause) ||
        null,
      firmwareVersion:
        this.asString(
          payload.firmware_version ??
            payload.firmwareVersion ??
            payload.software_version ??
            payload.softwareVersion
        ) ||
        this.asString(
          identity.firmware_version ??
            identity.firmwareVersion ??
            identity.software_version ??
            identity.softwareVersion
        ) ||
        null,
      hardwareRev:
        this.asString(payload.hardware_rev ?? payload.hardwareRev) ||
        this.asString(identity.hardware_rev ?? identity.hardwareRev) ||
        null,
      networkLostCount:
        this.asInteger(payload.network_lost_count ?? payload.networkLostCount ?? commonStatus.network_lost_count ?? commonStatus.networkLostCount),
      powerLossCount:
        this.asInteger(payload.power_loss_count ?? payload.powerLossCount ?? commonStatus.power_loss_count ?? commonStatus.powerLossCount),
      lastDisconnectReason:
        this.asString(
          payload.last_disconnect_reason ??
            payload.lastDisconnectReason ??
            commonStatus.last_disconnect_reason ??
            commonStatus.lastDisconnectReason
        ) || null,
      lastDisconnectConnAgeMs:
        this.asInteger(
          payload.last_disconnect_conn_age_ms ??
            payload.lastDisconnectConnAgeMs ??
            commonStatus.last_disconnect_conn_age_ms ??
            commonStatus.lastDisconnectConnAgeMs
        ),
      lastDisconnectLastTxType:
        this.asString(
          payload.last_disconnect_last_tx_type ??
            payload.lastDisconnectLastTxType ??
            commonStatus.last_disconnect_last_tx_type ??
            commonStatus.lastDisconnectLastTxType
        ) || null
    };
  }

  private buildDisconnectSignature(metrics: ReturnType<RuntimeIngestService['extractStatusMetrics']>) {
    if (!metrics.lastDisconnectReason) return null;
    return [
      metrics.lastDisconnectReason,
      metrics.lastDisconnectConnAgeMs ?? '',
      metrics.lastDisconnectLastTxType ?? '',
      metrics.bootSessionId ?? '',
      metrics.networkLostCount ?? '',
      metrics.powerLossCount ?? ''
    ].join('|');
  }

  private detectReboot(
    previous: RuntimeStatusRow | null,
    metrics: ReturnType<RuntimeIngestService['extractStatusMetrics']>
  ) {
    if (metrics.eventCode === 'device_booted') {
      return 'device_booted_event';
    }
    if (
      previous?.currentBootSessionId &&
      metrics.bootSessionId &&
      previous.currentBootSessionId !== metrics.bootSessionId
    ) {
      return 'boot_session_changed';
    }
    if (
      previous?.currentUptimeSec !== null &&
      previous?.currentUptimeSec !== undefined &&
      metrics.uptimeSec !== null &&
      metrics.uptimeSec !== undefined &&
      metrics.uptimeSec + 60 < previous.currentUptimeSec
    ) {
      return 'uptime_rollback';
    }
    return null;
  }

  private buildCommonStatus(
    payload: Record<string, unknown>,
    envelope: DeviceEnvelope,
    event: DeviceRuntimeEvent
  ) {
    const commonStatus = this.asObject(payload.common_status ?? payload.commonStatus);
    const controllerState = this.asObject(payload.controller_state ?? payload.controllerState);
    const merged = {
      ...commonStatus,
      ...controllerState,
      run_state:
        this.asString(envelope.runState) ||
        this.asString(controllerState.run_state) ||
        this.asString(controllerState.runState) ||
        this.asString(payload.run_state) ||
        this.asString(payload.runState) ||
        null,
      power_state:
        this.asString(envelope.powerState) ||
        this.asString(commonStatus.power_state) ||
        this.asString(commonStatus.powerState) ||
        this.asString(payload.power_state) ||
        this.asString(payload.powerState) ||
        null,
      alarm_codes:
        this.asStringArray(envelope.alarmCodes).length > 0
          ? this.asStringArray(envelope.alarmCodes)
          : this.asStringArray(commonStatus.fault_codes ?? commonStatus.alarm_codes ?? payload.alarm_codes ?? payload.alarmCodes),
      cumulative_runtime_sec: envelope.cumulativeRuntimeSec ?? null,
      cumulative_energy_wh: envelope.cumulativeEnergyWh ?? null,
      cumulative_flow: envelope.cumulativeFlow ?? null,
      meter_protocol:
        this.asString(payload.meter_protocol ?? payload.meterProtocol ?? commonStatus.meter_protocol ?? commonStatus.meterProtocol) || null,
      control_protocol:
        this.asString(payload.control_protocol ?? payload.controlProtocol ?? commonStatus.control_protocol ?? commonStatus.controlProtocol) || null,
      breaker_state:
        this.asString(payload.breaker_state ?? payload.breakerState ?? commonStatus.breaker_state ?? commonStatus.breakerState) || null,
      last_event_type: event.eventType,
      last_msg_type: event.msgType,
      last_msg_id: event.msgId,
      last_seq_no: event.seqNo,
      config_version: this.asInteger(payload.config_version ?? payload.configVersion),
      firmware_family: this.asString(payload.firmware_family ?? payload.firmwareFamily) || null,
      firmware_version:
        this.asString(
          payload.firmware_version ??
            payload.firmwareVersion ??
            payload.software_version ??
            payload.softwareVersion
        ) || null,
      controller_role: this.asString(payload.controller_role ?? payload.controllerRole) || null,
      deployment_mode: this.asString(payload.deployment_mode ?? payload.deploymentMode) || null
    };

    return { commonStatus, controllerState, merged };
  }

  private inferModuleCode(channel: Record<string, unknown>, featureModules: string[]) {
    const explicit = this.asString(channel.module_code ?? channel.moduleCode);
    if (explicit) return explicit;

    const role = this.asString(channel.channel_role ?? channel.channelRole).toLowerCase();
    if (role.includes('pressure')) return 'pressure_acquisition';
    if (role.includes('flow')) return 'flow_acquisition';
    if (role.includes('soil_moisture')) return 'soil_moisture_acquisition';
    if (role.includes('soil_temperature')) return 'soil_temperature_acquisition';
    if (role.includes('level')) return 'level_acquisition';
    if (role.includes('valve')) {
      if (featureModules.includes('dual_valve_control')) return 'dual_valve_control';
      return 'single_valve_control';
    }
    if (role.includes('power')) return 'power_monitoring';
    if (role.includes('pump') || role.includes('vfd')) {
      if (featureModules.includes('pump_direct_control')) return 'pump_direct_control';
      return 'pump_vfd_control';
    }
    return featureModules[0] || 'common_status';
  }

  private inferMetricCode(channel: Record<string, unknown>) {
    const explicit = this.asString(channel.metric_code ?? channel.metricCode);
    if (explicit) return explicit;

    const moduleCode = this.asString(channel.module_code ?? channel.moduleCode).toLowerCase();
    const role = this.asString(channel.channel_role ?? channel.channelRole).toLowerCase();
    const unit = this.asString(channel.unit).toLowerCase();
    if (moduleCode.includes('breaker') || role.includes('breaker')) return 'breaker_state';
    if (role.includes('pressure')) return 'pressure_mpa';
    if (role.includes('flow')) return 'flow_m3h';
    if (role.includes('soil_moisture')) return 'soil_moisture_vwc';
    if (role.includes('soil_temperature')) return 'soil_temperature_c';
    if (role.includes('level')) return 'level_m';
    if (role.includes('power')) {
      if (unit === 'kwh') return 'energy_kwh';
      if (unit === 'kw') return 'power_kw';
      if (unit === 'a') return 'current_a';
      if (unit === 'v') return 'voltage_v';
      return 'power_value';
    }
    if (this.asString(channel.feedback_state ?? channel.feedbackState)) return 'feedback_state';
    if (this.asString(channel.state)) return 'state';
    if (this.asNumber(channel.value) !== null) return 'value';
    return 'status';
  }

  private buildModuleStates(
    payload: Record<string, unknown>,
    featureModules: string[],
    channels: Record<string, unknown>[]
  ) {
    const explicitSource = payload.module_states ?? payload.moduleStates;
    const explicit = Array.isArray(explicitSource)
      ? explicitSource
          .map((item: unknown) => this.asObject(item))
          .filter((item: Record<string, unknown>) => Object.keys(item).length > 0)
      : [];
    if (explicit.length > 0) return explicit;

    return featureModules.map((moduleCode) => {
      const relatedChannels = channels.filter((channel) => this.inferModuleCode(channel, featureModules) === moduleCode);
      return {
        module_code: moduleCode,
        module_instance_code: null,
        enabled: true,
        health: 'normal',
        status: relatedChannels.some((item) => this.asString(item.state).toUpperCase() === 'ON') ? 'active' : 'idle',
        fault_codes: []
      };
    });
  }

  private buildChannelRows(
    tenantId: string,
    device: RuntimeDeviceRef,
    event: DeviceRuntimeEvent,
    payload: Record<string, unknown>,
    featureModules: string[]
  ) {
    const rows: ChannelLatestUpsertInput[] = [];
    const normalizedChannels = Array.isArray(payload.channels)
      ? payload.channels
          .map((item: unknown) => this.asObject(item))
          .filter((item: Record<string, unknown>) => Object.keys(item).length > 0)
      : [];
    const normalizedChannelValuesSource = payload.channel_values ?? payload.channelValues;
    const normalizedChannelValues = Array.isArray(normalizedChannelValuesSource)
      ? normalizedChannelValuesSource
          .map((item: unknown) => this.asObject(item))
          .filter((item: Record<string, unknown>) => Object.keys(item).length > 0)
      : [];

    for (const channel of normalizedChannels) {
      const channelCode = this.asString(channel.channel_code ?? channel.channelCode);
      if (!channelCode) continue;
      const moduleCode = this.inferModuleCode(channel, featureModules);
      const metricBase = this.inferMetricCode(channel);
      const sourceNodeCode = this.asString(channel.bind_target_code ?? channel.bindTargetCode) || device.sourceNodeCode || null;
      const collectedAt = this.toIsoTimestamp(channel.collected_at ?? channel.collectedAt ?? event.deviceTs);
      const quality = this.asString(channel.quality) || (this.asBoolean(channel.enabled) ? 'good' : 'disabled') || null;
      const faultCodes = this.asStringArray(channel.fault_codes ?? channel.faultCodes);
      const value = this.asNumber(channel.value);
      const state = this.asString(channel.state) || null;
      const feedbackState = this.asString(channel.feedback_state ?? channel.feedbackState) || null;

      if (value !== null || state === null) {
        rows.push({
          tenantId,
          deviceId: device.id,
          imei: device.imei,
          projectId: this.toUuidOrNull(device.projectId),
          blockId: this.toUuidOrNull(device.blockId),
          sourceNodeCode,
          moduleCode,
          moduleInstanceCode: this.asString(channel.module_instance_code ?? channel.moduleInstanceCode) || null,
          channelCode,
          metricCode: metricBase,
          valueNum: value,
          valueText: value === null ? state : null,
          unit: this.asString(channel.unit) || null,
          quality: quality || null,
          faultCodes,
          collectedAt,
          serverRxTs: this.toIsoTimestamp(event.serverRxTs),
          lastMsgId: event.msgId,
          lastSeqNo: event.seqNo
        });
      }

      if (state) {
        rows.push({
          tenantId,
          deviceId: device.id,
          imei: device.imei,
          projectId: this.toUuidOrNull(device.projectId),
          blockId: this.toUuidOrNull(device.blockId),
          sourceNodeCode,
          moduleCode,
          moduleInstanceCode: this.asString(channel.module_instance_code ?? channel.moduleInstanceCode) || null,
          channelCode,
          metricCode: 'state',
          valueNum: null,
          valueText: state,
          unit: null,
          quality: quality || null,
          faultCodes,
          collectedAt,
          serverRxTs: this.toIsoTimestamp(event.serverRxTs),
          lastMsgId: event.msgId,
          lastSeqNo: event.seqNo
        });
      }

      if (feedbackState) {
        rows.push({
          tenantId,
          deviceId: device.id,
          imei: device.imei,
          projectId: this.toUuidOrNull(device.projectId),
          blockId: this.toUuidOrNull(device.blockId),
          sourceNodeCode,
          moduleCode,
          moduleInstanceCode: this.asString(channel.module_instance_code ?? channel.moduleInstanceCode) || null,
          channelCode,
          metricCode: 'feedback_state',
          valueNum: null,
          valueText: feedbackState,
          unit: null,
          quality: quality || null,
          faultCodes,
          collectedAt,
          serverRxTs: this.toIsoTimestamp(event.serverRxTs),
          lastMsgId: event.msgId,
          lastSeqNo: event.seqNo
        });
      }
    }

    for (const channelValue of normalizedChannelValues) {
      const channelCode = this.asString(channelValue.channel_code ?? channelValue.channelCode);
      const metricCode = this.asString(channelValue.metric_code ?? channelValue.metricCode);
      if (!channelCode || !metricCode) continue;
      rows.push({
        tenantId,
        deviceId: device.id,
        imei: device.imei,
        projectId: this.toUuidOrNull(device.projectId),
        blockId: this.toUuidOrNull(device.blockId),
        sourceNodeCode:
          this.asString(channelValue.bind_target_code ?? channelValue.bindTargetCode) || device.sourceNodeCode || null,
        moduleCode: this.inferModuleCode(channelValue, featureModules),
        moduleInstanceCode: this.asString(channelValue.module_instance_code ?? channelValue.moduleInstanceCode) || null,
        channelCode,
        metricCode,
        valueNum: this.asNumber(channelValue.value),
        valueText: this.asNumber(channelValue.value) === null ? this.asString(channelValue.value) || null : null,
        unit: this.asString(channelValue.unit) || null,
        quality: this.asString(channelValue.quality) || 'good',
        faultCodes: this.asStringArray(channelValue.fault_codes ?? channelValue.faultCodes),
        collectedAt: this.toIsoTimestamp(channelValue.collected_at ?? channelValue.collectedAt ?? event.deviceTs),
        serverRxTs: this.toIsoTimestamp(event.serverRxTs),
        lastMsgId: event.msgId,
        lastSeqNo: event.seqNo
      });
    }

    const deduped = new Map<string, ChannelLatestUpsertInput>();
    for (const row of rows) {
      deduped.set(`${row.channelCode}::${row.metricCode}`, row);
    }
    return {
      hasSnapshotChannels:
        event.eventType === 'DEVICE_STATE_SNAPSHOT' &&
        (Array.isArray(payload.channels) || normalizedChannelValues.length > 0 || rows.length > 0),
      channelRows: Array.from(deduped.values()),
      normalizedChannels,
    };
  }

  async syncHealthState(
    params: {
      tenantId: string;
      device: RuntimeDeviceRef;
      envelope: DeviceEnvelope;
      event: DeviceRuntimeEvent;
    },
    client: PoolClient
  ) {
    const payload = this.asObject(params.event.payload);
    const serverRxTs = this.toIsoTimestamp(params.event.serverRxTs) ?? new Date().toISOString();
    const previous = await this.repository.findRuntimeStatusByDeviceId(params.tenantId, params.device.id, client);
    const openOffline = await this.repository.findOpenOfflineEvent(params.tenantId, params.device.id, client);
    const metrics = this.extractStatusMetrics(payload);
    const disconnectSignature = this.buildDisconnectSignature(metrics);
    const hasExplicitDisconnectReason = Boolean(metrics.lastDisconnectReason);
    const peerCloseSignal = this.isPeerCloseReason(metrics.lastDisconnectReason);
    const peerCloseTriggered =
      hasExplicitDisconnectReason &&
      peerCloseSignal &&
      Boolean(disconnectSignature) &&
      disconnectSignature !== previous?.lastDisconnectSignature;
    let peerCloseSuspectStreak = previous?.peerCloseSuspectStreak ?? 0;
    if (hasExplicitDisconnectReason) {
      peerCloseSuspectStreak = peerCloseSignal
        ? peerCloseTriggered
          ? (previous?.peerCloseSuspectStreak ?? 0) + 1
          : previous?.peerCloseSuspectStreak ?? 0
        : 0;
    }

    if (peerCloseTriggered) {
      await this.repository.upsertDailyHealthDelta(
        {
          tenantId: params.tenantId,
          deviceId: params.device.id,
          imei: params.device.imei,
          day: this.dayKey(serverRxTs),
          peerCloseSuspectCountDelta: 1
        },
        client
      );
    }

    if (params.event.eventType === 'DEVICE_REGISTERED') {
      await this.repository.upsertDailyHealthDelta(
        {
          tenantId: params.tenantId,
          deviceId: params.device.id,
          imei: params.device.imei,
          day: this.dayKey(serverRxTs),
          registerCountDelta: 1
        },
        client
      );
    }

    const rebootReasonType = this.detectReboot(previous, metrics);
    if (rebootReasonType) {
      await this.repository.insertRebootEvent(
        {
          tenantId: params.tenantId,
          deviceId: params.device.id,
          imei: params.device.imei,
          detectedAt: serverRxTs,
          reasonType: rebootReasonType,
          previousBootSessionId: previous?.currentBootSessionId ?? null,
          currentBootSessionId: metrics.bootSessionId,
          previousUptimeSec: previous?.currentUptimeSec ?? null,
          currentUptimeSec: metrics.uptimeSec,
          resetCause: metrics.resetCause,
          sourceMsgType: params.event.msgType,
          sourceMsgId: params.event.msgId
        },
        client
      );
      await this.repository.upsertDailyHealthDelta(
        {
          tenantId: params.tenantId,
          deviceId: params.device.id,
          imei: params.device.imei,
          day: this.dayKey(serverRxTs),
          rebootCountDelta: 1
        },
        client
      );
    }

    let latestOfflineEvent = openOffline;
    let frequentRebootRecoveryStreak = previous?.frequentRebootRecoveryStreak ?? 0;
    let lastOfflineEndedAt = previous?.lastOfflineEndedAt ?? null;
    let lastOfflineDurationSec = previous?.lastOfflineDurationSec ?? null;
    let lastRecoverMsgType = previous?.lastRecoverMsgType ?? null;
    let lastRecoverBootSessionId = previous?.lastRecoverBootSessionId ?? null;
    let lastRecoveredAt = previous?.lastRecoveredAt ?? null;

    if (openOffline) {
      const durationSec = this.diffSeconds(openOffline.offlineStartedAt, serverRxTs) ?? 0;
      const closedOffline = await this.repository.closeOfflineEvent(
        {
          eventId: openOffline.id,
          offlineEndedAt: serverRxTs,
          offlineDurationSec: durationSec,
          recoverMsgType: params.event.msgType,
          recoverBootSessionId: metrics.bootSessionId
        },
        client
      );
      latestOfflineEvent = closedOffline;
      lastOfflineEndedAt = serverRxTs;
      lastOfflineDurationSec = durationSec;
      lastRecoverMsgType = params.event.msgType;
      lastRecoverBootSessionId = metrics.bootSessionId;
      lastRecoveredAt = serverRxTs;

      const durationSegments = this.distributeDurationByDay(openOffline.offlineStartedAt, serverRxTs);
      for (const [index, segment] of durationSegments.entries()) {
        await this.repository.upsertDailyHealthDelta(
          {
            tenantId: params.tenantId,
            deviceId: params.device.id,
            imei: params.device.imei,
            day: segment.day,
            offlineCountDelta: index === 0 ? 1 : 0,
            offlineTotalSecDelta: segment.durationSec
          },
          client
        );
      }

      const recentRecovered = await this.repository.listRecentRecoveredOfflineEvents(params.tenantId, params.device.id, 3, client);
      frequentRebootRecoveryStreak = 0;
      for (const item of recentRecovered) {
        const changedBootSession =
          this.asString(item.offlineStartBootSessionId) &&
          this.asString(item.recoverBootSessionId) &&
          item.offlineStartBootSessionId !== item.recoverBootSessionId;
        if (changedBootSession) {
          frequentRebootRecoveryStreak += 1;
        } else {
          break;
        }
      }
    }

    const registerCountLastHour = await this.repository.countRegisterEventsSince(
      params.tenantId,
      params.device.id,
      new Date(new Date(serverRxTs).getTime() - 60 * 60 * 1000).toISOString(),
      client
    );
    const registerAlertLevel = this.computeRegisterAlertLevel(registerCountLastHour);
    const todayDay = this.dayKey(serverRxTs);
    const today = (await this.repository.findDailyHealthByDay(params.tenantId, params.device.id, todayDay, client)) ??
      this.getTodayDefault(todayDay, params.device.imei, params.tenantId, params.device.id);
    const healthFlags = this.buildHealthFlags({
      registerAlertLevel,
      frequentRebootRecoveryStreak,
      peerCloseSuspectStreak
    });

    return this.repository.upsertRuntimeStatus(
      {
        tenantId: params.tenantId,
        deviceId: params.device.id,
        imei: params.device.imei,
        isOnline: true,
        onlineState: openOffline ? 'online_recovered' : 'online',
        statusReason: openOffline ? 'uplink_recovered' : 'uplink_seen',
        lastSeenAt: serverRxTs,
        lastHeartbeatAt:
          params.event.eventType === 'DEVICE_HEARTBEAT' ? serverRxTs : previous?.lastHeartbeatAt ?? null,
        lastSnapshotAt:
          params.event.eventType === 'DEVICE_STATE_SNAPSHOT' || params.event.eventType === 'DEVICE_REGISTERED'
            ? serverRxTs
            : previous?.lastSnapshotAt ?? null,
        lastRegisterAt: params.event.eventType === 'DEVICE_REGISTERED' ? serverRxTs : previous?.lastRegisterAt ?? null,
        lastRecoveredAt,
        currentBootSessionId: metrics.bootSessionId ?? previous?.currentBootSessionId ?? null,
        currentUptimeSec: metrics.uptimeSec ?? previous?.currentUptimeSec ?? null,
        currentResetCause: metrics.resetCause ?? previous?.currentResetCause ?? null,
        firmwareVersion: metrics.firmwareVersion ?? previous?.firmwareVersion ?? null,
        hardwareRev: metrics.hardwareRev ?? previous?.hardwareRev ?? null,
        todayRegisterCount: today.registerCount,
        registerCountLastHour,
        registerAlertLevel,
        networkLostCount: metrics.networkLostCount ?? previous?.networkLostCount ?? null,
        powerLossCount: metrics.powerLossCount ?? previous?.powerLossCount ?? null,
        lastDisconnectReason: metrics.lastDisconnectReason ?? previous?.lastDisconnectReason ?? null,
        lastDisconnectConnAgeMs: metrics.lastDisconnectConnAgeMs ?? previous?.lastDisconnectConnAgeMs ?? null,
        lastDisconnectLastTxType: metrics.lastDisconnectLastTxType ?? previous?.lastDisconnectLastTxType ?? null,
        lastDisconnectSignature: disconnectSignature ?? previous?.lastDisconnectSignature ?? null,
        peerCloseSuspectStreak,
        frequentRebootRecoveryStreak,
        healthFlags,
        lastOfflineStartedAt: latestOfflineEvent?.offlineStartedAt ?? previous?.lastOfflineStartedAt ?? null,
        lastOfflineEndedAt,
        lastOfflineDurationSec,
        lastRecoverMsgType,
        lastRecoverBootSessionId,
        lastRebootAt: rebootReasonType ? serverRxTs : previous?.lastRebootAt ?? null
      },
      client
    );
  }

  async sweepHealthState(tenantId: string, client: PoolClient) {
    const statuses = await this.repository.listRuntimeStatusesForSweep(tenantId, client);
    const nowIso = new Date().toISOString();
    let offlineSuspected = 0;
    let offlineConfirmed = 0;
    let openedEvents = 0;

    for (const status of statuses) {
      const anchor = status.lastHeartbeatAt ?? status.lastSeenAt;
      if (!anchor) continue;

      const secondsSinceHeartbeat = this.diffSeconds(anchor, nowIso);
      if (secondsSinceHeartbeat === null || secondsSinceHeartbeat < 70) {
        continue;
      }

      const offlineStartedAt = this.addSeconds(anchor, 70) ?? anchor;
      let offlineEvent: OfflineEventRow | null = await this.repository.findOpenOfflineEvent(tenantId, status.deviceId, client);
      if (!offlineEvent) {
        offlineEvent = await this.repository.openOfflineEvent(
          {
            tenantId,
            deviceId: status.deviceId,
            imei: status.imei,
            offlineState: secondsSinceHeartbeat >= 90 ? 'offline_confirmed' : 'offline_suspected',
            offlineStartedAt,
            offlineStartBootSessionId: status.currentBootSessionId ?? null
          },
          client
        );
        openedEvents += offlineEvent ? 1 : 0;
      }

      if (secondsSinceHeartbeat >= 90 && offlineEvent && !offlineEvent.offlineConfirmedAt) {
        await this.repository.confirmOfflineEvent(
          offlineEvent.id,
          this.addSeconds(anchor, 90) ?? nowIso,
          client
        );
      }

      const nextOnlineState = secondsSinceHeartbeat >= 90 ? 'offline_confirmed' : 'offline_suspected';
      if (nextOnlineState === 'offline_confirmed') {
        offlineConfirmed += 1;
      } else {
        offlineSuspected += 1;
      }

      const healthFlags = this.buildHealthFlags({
        registerAlertLevel: status.registerAlertLevel,
        frequentRebootRecoveryStreak: status.frequentRebootRecoveryStreak,
        peerCloseSuspectStreak: status.peerCloseSuspectStreak
      });

      await this.repository.upsertRuntimeStatus(
        {
          tenantId,
          deviceId: status.deviceId,
          imei: status.imei,
          isOnline: false,
          onlineState: nextOnlineState,
          statusReason: 'heartbeat_timeout',
          lastSeenAt: status.lastSeenAt,
          lastHeartbeatAt: status.lastHeartbeatAt,
          lastSnapshotAt: status.lastSnapshotAt,
          lastRegisterAt: status.lastRegisterAt,
          lastRecoveredAt: status.lastRecoveredAt,
          currentBootSessionId: status.currentBootSessionId,
          currentUptimeSec: status.currentUptimeSec,
          currentResetCause: status.currentResetCause,
          firmwareVersion: status.firmwareVersion,
          hardwareRev: status.hardwareRev,
          todayRegisterCount: status.todayRegisterCount,
          registerCountLastHour: status.registerCountLastHour,
          registerAlertLevel: status.registerAlertLevel,
          networkLostCount: status.networkLostCount,
          powerLossCount: status.powerLossCount,
          lastDisconnectReason: status.lastDisconnectReason,
          lastDisconnectConnAgeMs: status.lastDisconnectConnAgeMs,
          lastDisconnectLastTxType: status.lastDisconnectLastTxType,
          lastDisconnectSignature: status.lastDisconnectSignature,
          peerCloseSuspectStreak: status.peerCloseSuspectStreak,
          frequentRebootRecoveryStreak: status.frequentRebootRecoveryStreak,
          healthFlags,
          lastOfflineStartedAt: offlineEvent?.offlineStartedAt ?? status.lastOfflineStartedAt ?? offlineStartedAt,
          lastOfflineEndedAt: status.lastOfflineEndedAt,
          lastOfflineDurationSec: status.lastOfflineDurationSec,
          lastRecoverMsgType: status.lastRecoverMsgType,
          lastRecoverBootSessionId: status.lastRecoverBootSessionId,
          lastRebootAt: status.lastRebootAt
        },
        client
      );
    }

    return {
      scanned: statuses.length,
      offline_suspected_count: offlineSuspected,
      offline_confirmed_count: offlineConfirmed,
      opened_offline_event_count: openedEvents
    };
  }

  async getRuntimeStatusByDeviceId(tenantId: string, deviceId: string): Promise<RuntimeStatusRow | null> {
    return this.repository.findRuntimeStatusByDeviceId(tenantId, deviceId);
  }

  async getRuntimeHealthSnapshot(tenantId: string, deviceId: string): Promise<RuntimeHealthSnapshot> {
    const runtimeStatus = await this.repository.findRuntimeStatusByDeviceId(tenantId, deviceId);
    const latestOfflineEvent = await this.repository.findLatestOfflineEvent(tenantId, deviceId);
    const todayDay = this.dayKey(new Date().toISOString());
    const todayStored = runtimeStatus
      ? await this.repository.findDailyHealthByDay(tenantId, deviceId, todayDay)
      : null;
    const recentRebootEvents = await this.repository.listRecentRebootEvents(tenantId, deviceId, 5);

    let today = todayStored ?? (runtimeStatus ? this.getTodayDefault(todayDay, runtimeStatus.imei, tenantId, deviceId) : null);
    if (
      today &&
      runtimeStatus &&
      runtimeStatus.onlineState.startsWith('offline') &&
      runtimeStatus.lastOfflineStartedAt
    ) {
      const startOfToday = `${todayDay}T00:00:00.000Z`;
      const effectiveStart = new Date(runtimeStatus.lastOfflineStartedAt) > new Date(startOfToday)
        ? runtimeStatus.lastOfflineStartedAt
        : startOfToday;
      const additionalOfflineSec = this.diffSeconds(effectiveStart, new Date().toISOString()) ?? 0;
      today = {
        ...today,
        offlineTotalSec: today.offlineTotalSec + additionalOfflineSec,
        availability: Math.max(0, Math.min(1, 1 - (today.offlineTotalSec + additionalOfflineSec) / 86400))
      };
    }

    return {
      runtimeStatus,
      latestOfflineEvent,
      today,
      recentRebootEvents
    };
  }

  async syncDerivedState(
    params: {
      tenantId: string;
      device: RuntimeDeviceRef;
      envelope: DeviceEnvelope;
      event: DeviceRuntimeEvent;
      lastCommandId?: string | null;
    },
    client: PoolClient
  ) {
    const payload = this.asObject(params.event.payload);
    const featureModules = this.asStringArray(payload.feature_modules ?? payload.featureModules);
    const { commonStatus, controllerState, merged } = this.buildCommonStatus(payload, params.envelope, params.event);
    const { hasSnapshotChannels, channelRows, normalizedChannels } = this.buildChannelRows(
      params.tenantId,
      params.device,
      params.event,
      payload,
      featureModules
    );
    const moduleStates = this.buildModuleStates(payload, featureModules, normalizedChannels);
    const workflowState = resolveRuntimeShadowWorkflowState({
      payload,
      controllerState,
    });
    const runState =
      this.asString(merged.run_state) ||
      this.asString(controllerState.run_state ?? controllerState.runState) ||
      null;
    const readySignal =
      payload.ready ??
      payload.is_ready ??
      payload.isReady ??
      controllerState.ready ??
      commonStatus.ready;
    const onlineSignal = controllerState.online ?? commonStatus.online;
    const inferredReadyStates = new Set(['READY', 'READY_IDLE', 'STARTING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING']);
    const inferredReady =
      inferredReadyStates.has(this.asString(workflowState).toUpperCase()) ||
      inferredReadyStates.has(this.asString(runState).toUpperCase());
    const shadowInput: RuntimeShadowUpsertInput = {
      tenantId: params.tenantId,
      deviceId: params.device.id,
      imei: params.device.imei,
      projectId: this.toUuidOrNull(params.device.projectId),
      blockId: this.toUuidOrNull(params.device.blockId),
      sourceNodeCode: this.asString(params.device.sourceNodeCode) || null,
      lastMsgId: params.event.msgId,
      lastSeqNo: params.event.seqNo,
      lastMsgType: params.event.msgType,
      lastDeviceTs: this.toIsoTimestamp(params.envelope.deviceTs),
      lastServerRxTs: this.toIsoTimestamp(params.event.serverRxTs),
      lastHeartbeatAt:
        params.event.eventType === 'DEVICE_HEARTBEAT'
          ? this.toIsoTimestamp(params.event.serverRxTs)
          : null,
      lastSnapshotAt:
        params.event.eventType === 'DEVICE_STATE_SNAPSHOT' || params.event.eventType === 'DEVICE_REGISTERED'
          ? this.toIsoTimestamp(params.event.serverRxTs)
          : null,
      lastEventAt: this.toIsoTimestamp(params.event.serverRxTs),
      connectionState: 'connected',
      onlineState:
        params.event.eventType === 'DEVICE_ALARM_RAISED'
          ? 'alarm'
          : onlineSignal !== undefined && this.asBoolean(onlineSignal) === false
            ? 'offline'
            : 'online',
      workflowState,
      runState,
      powerState:
        this.asString(merged.power_state) ||
        this.asString(commonStatus.power_mode ?? commonStatus.powerMode) ||
        null,
      ready: readySignal === undefined ? inferredReady : this.asBoolean(readySignal),
      configVersion: this.asInteger(payload.config_version ?? payload.configVersion),
      firmwareFamily: this.asString(payload.firmware_family ?? payload.firmwareFamily) || null,
      firmwareVersion:
        this.asString(
          payload.firmware_version ??
            payload.firmwareVersion ??
            payload.software_version ??
            payload.softwareVersion
        ) || null,
      signalCsq: this.asInteger(commonStatus.signal_csq ?? commonStatus.signalCsq),
      signalRsrp: this.asInteger(commonStatus.signal_rsrp ?? commonStatus.signalRsrp),
      batterySoc: this.asNumber(commonStatus.battery_soc ?? commonStatus.batterySoc),
      batteryVoltage: this.asNumber(
        commonStatus.battery_voltage ?? commonStatus.batteryVoltage ?? controllerState.battery_voltage ?? controllerState.batteryVoltage
      ),
      solarVoltage: this.asNumber(
        commonStatus.solar_voltage ?? commonStatus.solarVoltage ?? controllerState.solar_voltage ?? controllerState.solarVoltage
      ),
      alarmCodes: this.asStringArray(merged.alarm_codes),
      commonStatus: merged,
      moduleStates,
      lastCommandId: this.toUuidOrNull(params.lastCommandId)
    };

    await this.repository.upsertRuntimeShadow(shadowInput, client);

    if (hasSnapshotChannels) {
      await this.repository.replaceChannelLatest(params.tenantId, params.device.id, channelRows, client);
      return;
    }

    if (channelRows.length > 0) {
      await this.repository.upsertChannelLatest(channelRows, client);
    }
  }

  async syncConnectionState(
    params: {
      tenantId: string;
      device: RuntimeDeviceRef;
      connectionState: string;
      onlineState?: string | null;
      lastHeartbeatAt?: string | null;
      lastEventAt?: string | null;
    },
    client: PoolClient
  ) {
    const input: RuntimeConnectionStateUpsertInput = {
      tenantId: params.tenantId,
      deviceId: params.device.id,
      imei: params.device.imei,
      projectId: this.toUuidOrNull(params.device.projectId),
      blockId: this.toUuidOrNull(params.device.blockId),
      sourceNodeCode: this.asString(params.device.sourceNodeCode) || null,
      connectionState: this.asString(params.connectionState) || 'disconnected',
      onlineState: this.asString(params.onlineState) || null,
      lastHeartbeatAt: this.toIsoTimestamp(params.lastHeartbeatAt),
      lastEventAt: this.toIsoTimestamp(params.lastEventAt)
    };

    await this.repository.upsertConnectionState(input, client);
  }

  async getRuntimeShadowByDeviceId(tenantId: string, deviceId: string): Promise<RuntimeShadowRow | null> {
    return this.repository.findRuntimeShadowByDeviceId(tenantId, deviceId);
  }

  async getRuntimeShadowByImei(tenantId: string, imei: string): Promise<RuntimeShadowRow | null> {
    return this.repository.findRuntimeShadowByImei(tenantId, imei);
  }

  async listRuntimeShadows(params: {
    tenantId: string;
    projectId?: string;
    blockId?: string;
    imei?: string;
    limit?: number;
  }): Promise<RuntimeShadowRow[]> {
    return this.repository.listRuntimeShadows(params);
  }

  async listChannelLatest(params: {
    tenantId: string;
    deviceId?: string;
    imei?: string;
    projectId?: string;
    blockId?: string;
    metricCode?: string;
    limit?: number;
  }): Promise<ChannelLatestRow[]> {
    return this.repository.listChannelLatest(params);
  }
}
