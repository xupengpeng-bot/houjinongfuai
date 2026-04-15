import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

const EMPTY_OBJECT_JSON = '{}';
const EMPTY_ARRAY_JSON = '[]';

export interface RuntimeShadowUpsertInput {
  tenantId: string;
  deviceId: string;
  imei: string;
  projectId: string | null;
  blockId: string | null;
  sourceNodeCode: string | null;
  lastMsgId: string | null;
  lastSeqNo: number | null;
  lastMsgType: string | null;
  lastDeviceTs: string | null;
  lastServerRxTs: string | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  lastEventAt: string | null;
  connectionState: string | null;
  onlineState: string | null;
  workflowState: string | null;
  runState: string | null;
  powerState: string | null;
  ready: boolean;
  configVersion: number | null;
  firmwareFamily: string | null;
  firmwareVersion: string | null;
  signalCsq: number | null;
  signalRsrp: number | null;
  batterySoc: number | null;
  batteryVoltage: number | null;
  solarVoltage: number | null;
  alarmCodes: string[];
  commonStatus: Record<string, unknown>;
  moduleStates: Record<string, unknown>[];
  lastCommandId: string | null;
}

export interface RuntimeConnectionStateUpsertInput {
  tenantId: string;
  deviceId: string;
  imei: string;
  projectId: string | null;
  blockId: string | null;
  sourceNodeCode: string | null;
  connectionState: string;
  onlineState: string | null;
  lastHeartbeatAt: string | null;
  lastEventAt: string | null;
}

export interface ChannelLatestUpsertInput {
  tenantId: string;
  deviceId: string;
  imei: string;
  projectId: string | null;
  blockId: string | null;
  sourceNodeCode: string | null;
  moduleCode: string;
  moduleInstanceCode: string | null;
  channelCode: string;
  metricCode: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  quality: string | null;
  faultCodes: string[];
  collectedAt: string | null;
  serverRxTs: string | null;
  lastMsgId: string | null;
  lastSeqNo: number | null;
}

export interface RuntimeStatusUpsertInput {
  tenantId: string;
  deviceId: string;
  imei: string;
  isOnline: boolean;
  onlineState: string;
  statusReason: string | null;
  lastSeenAt: string | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  lastRegisterAt: string | null;
  lastRecoveredAt: string | null;
  currentBootSessionId: string | null;
  currentUptimeSec: number | null;
  currentResetCause: string | null;
  firmwareVersion: string | null;
  hardwareRev: string | null;
  todayRegisterCount: number;
  registerCountLastHour: number;
  registerAlertLevel: string | null;
  networkLostCount: number | null;
  powerLossCount: number | null;
  lastDisconnectReason: string | null;
  lastDisconnectConnAgeMs: number | null;
  lastDisconnectLastTxType: string | null;
  lastDisconnectSignature: string | null;
  peerCloseSuspectStreak: number;
  frequentRebootRecoveryStreak: number;
  healthFlags: string[];
  lastOfflineStartedAt: string | null;
  lastOfflineEndedAt: string | null;
  lastOfflineDurationSec: number | null;
  lastRecoverMsgType: string | null;
  lastRecoverBootSessionId: string | null;
  lastRebootAt: string | null;
}

export interface RebootEventInsertInput {
  tenantId: string;
  deviceId: string;
  imei: string;
  detectedAt: string;
  reasonType: string;
  previousBootSessionId: string | null;
  currentBootSessionId: string | null;
  previousUptimeSec: number | null;
  currentUptimeSec: number | null;
  resetCause: string | null;
  sourceMsgType: string | null;
  sourceMsgId: string | null;
}

export interface RuntimeShadowRow {
  id: string;
  tenantId: string;
  deviceId: string;
  imei: string;
  projectId: string | null;
  blockId: string | null;
  sourceNodeCode: string | null;
  lastMsgId: string | null;
  lastSeqNo: number | null;
  lastMsgType: string | null;
  lastDeviceTs: string | null;
  lastServerRxTs: string | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  lastEventAt: string | null;
  connectionState: string;
  onlineState: string;
  workflowState: string | null;
  runState: string | null;
  powerState: string | null;
  ready: boolean;
  configVersion: number | null;
  firmwareFamily: string | null;
  firmwareVersion: string | null;
  signalCsq: number | null;
  signalRsrp: number | null;
  batterySoc: number | null;
  batteryVoltage: number | null;
  solarVoltage: number | null;
  alarmCodes: unknown;
  commonStatus: Record<string, unknown>;
  moduleStates: unknown;
  lastCommandId: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ChannelLatestRow {
  id: string;
  tenantId: string;
  deviceId: string;
  imei: string;
  projectId: string | null;
  blockId: string | null;
  sourceNodeCode: string | null;
  moduleCode: string;
  moduleInstanceCode: string | null;
  channelCode: string;
  metricCode: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  quality: string | null;
  faultCodes: unknown;
  collectedAt: string | null;
  serverRxTs: string | null;
  lastMsgId: string | null;
  lastSeqNo: number | null;
  updatedAt: string;
  createdAt: string;
}

export interface RuntimeStatusRow {
  id: string;
  tenantId: string;
  deviceId: string;
  imei: string;
  isOnline: boolean;
  onlineState: string;
  statusReason: string | null;
  lastSeenAt: string | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  lastRegisterAt: string | null;
  lastRecoveredAt: string | null;
  currentBootSessionId: string | null;
  currentUptimeSec: number | null;
  currentResetCause: string | null;
  firmwareVersion: string | null;
  hardwareRev: string | null;
  todayRegisterCount: number;
  registerCountLastHour: number;
  registerAlertLevel: string | null;
  networkLostCount: number | null;
  powerLossCount: number | null;
  lastDisconnectReason: string | null;
  lastDisconnectConnAgeMs: number | null;
  lastDisconnectLastTxType: string | null;
  lastDisconnectSignature: string | null;
  peerCloseSuspectStreak: number;
  frequentRebootRecoveryStreak: number;
  healthFlags: unknown;
  lastOfflineStartedAt: string | null;
  lastOfflineEndedAt: string | null;
  lastOfflineDurationSec: number | null;
  lastRecoverMsgType: string | null;
  lastRecoverBootSessionId: string | null;
  lastRebootAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface OfflineEventRow {
  id: string;
  tenantId: string;
  deviceId: string;
  imei: string;
  offlineState: string;
  offlineStartedAt: string;
  offlineConfirmedAt: string | null;
  offlineEndedAt: string | null;
  offlineDurationSec: number | null;
  recoverMsgType: string | null;
  recoverBootSessionId: string | null;
  offlineStartBootSessionId: string | null;
  status: string;
  updatedAt: string;
  createdAt: string;
}

export interface RebootEventRow {
  id: string;
  tenantId: string;
  deviceId: string;
  imei: string;
  detectedAt: string;
  reasonType: string;
  previousBootSessionId: string | null;
  currentBootSessionId: string | null;
  previousUptimeSec: number | null;
  currentUptimeSec: number | null;
  resetCause: string | null;
  sourceMsgType: string | null;
  sourceMsgId: string | null;
  createdAt: string;
}

export interface DeviceHealthDailyRow {
  tenantId: string;
  deviceId: string;
  day: string;
  imei: string;
  offlineCount: number;
  offlineTotalSec: number;
  availability: number;
  registerCount: number;
  rebootCount: number;
  peerCloseSuspectCount: number;
  updatedAt: string;
  createdAt: string;
}

@Injectable()
export class RuntimeIngestRepository {
  constructor(private readonly db: DatabaseService) {}

  async upsertRuntimeStatus(input: RuntimeStatusUpsertInput, client: PoolClient) {
    const result = await this.db.query<RuntimeStatusRow>(
      `
      insert into device_runtime_status (
        tenant_id,
        device_id,
        imei,
        is_online,
        online_state,
        status_reason,
        last_seen_at,
        last_heartbeat_at,
        last_snapshot_at,
        last_register_at,
        last_recovered_at,
        current_boot_session_id,
        current_uptime_sec,
        current_reset_cause,
        firmware_version,
        hardware_rev,
        today_register_count,
        register_count_last_hour,
        register_alert_level,
        network_lost_count,
        power_loss_count,
        last_disconnect_reason,
        last_disconnect_conn_age_ms,
        last_disconnect_last_tx_type,
        last_disconnect_signature,
        peer_close_suspect_streak,
        frequent_reboot_recovery_streak,
        health_flags_json,
        last_offline_started_at,
        last_offline_ended_at,
        last_offline_duration_sec,
        last_recover_msg_type,
        last_recover_boot_session_id,
        last_reboot_at
      )
      values (
        $1,
        $2::uuid,
        $3,
        $4,
        $5,
        $6,
        $7::timestamptz,
        $8::timestamptz,
        $9::timestamptz,
        $10::timestamptz,
        $11::timestamptz,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27,
        $28::jsonb,
        $29::timestamptz,
        $30::timestamptz,
        $31,
        $32,
        $33,
        $34::timestamptz
      )
      on conflict (tenant_id, device_id) do update
      set imei = excluded.imei,
          is_online = excluded.is_online,
          online_state = excluded.online_state,
          status_reason = excluded.status_reason,
          last_seen_at = coalesce(excluded.last_seen_at, device_runtime_status.last_seen_at),
          last_heartbeat_at = coalesce(excluded.last_heartbeat_at, device_runtime_status.last_heartbeat_at),
          last_snapshot_at = coalesce(excluded.last_snapshot_at, device_runtime_status.last_snapshot_at),
          last_register_at = coalesce(excluded.last_register_at, device_runtime_status.last_register_at),
          last_recovered_at = coalesce(excluded.last_recovered_at, device_runtime_status.last_recovered_at),
          current_boot_session_id = coalesce(excluded.current_boot_session_id, device_runtime_status.current_boot_session_id),
          current_uptime_sec = coalesce(excluded.current_uptime_sec, device_runtime_status.current_uptime_sec),
          current_reset_cause = coalesce(excluded.current_reset_cause, device_runtime_status.current_reset_cause),
          firmware_version = coalesce(excluded.firmware_version, device_runtime_status.firmware_version),
          hardware_rev = coalesce(excluded.hardware_rev, device_runtime_status.hardware_rev),
          today_register_count = excluded.today_register_count,
          register_count_last_hour = excluded.register_count_last_hour,
          register_alert_level = excluded.register_alert_level,
          network_lost_count = coalesce(excluded.network_lost_count, device_runtime_status.network_lost_count),
          power_loss_count = coalesce(excluded.power_loss_count, device_runtime_status.power_loss_count),
          last_disconnect_reason = coalesce(excluded.last_disconnect_reason, device_runtime_status.last_disconnect_reason),
          last_disconnect_conn_age_ms = coalesce(excluded.last_disconnect_conn_age_ms, device_runtime_status.last_disconnect_conn_age_ms),
          last_disconnect_last_tx_type = coalesce(excluded.last_disconnect_last_tx_type, device_runtime_status.last_disconnect_last_tx_type),
          last_disconnect_signature = coalesce(excluded.last_disconnect_signature, device_runtime_status.last_disconnect_signature),
          peer_close_suspect_streak = excluded.peer_close_suspect_streak,
          frequent_reboot_recovery_streak = excluded.frequent_reboot_recovery_streak,
          health_flags_json = excluded.health_flags_json,
          last_offline_started_at = coalesce(excluded.last_offline_started_at, device_runtime_status.last_offline_started_at),
          last_offline_ended_at = coalesce(excluded.last_offline_ended_at, device_runtime_status.last_offline_ended_at),
          last_offline_duration_sec = coalesce(excluded.last_offline_duration_sec, device_runtime_status.last_offline_duration_sec),
          last_recover_msg_type = coalesce(excluded.last_recover_msg_type, device_runtime_status.last_recover_msg_type),
          last_recover_boot_session_id = coalesce(excluded.last_recover_boot_session_id, device_runtime_status.last_recover_boot_session_id),
          last_reboot_at = coalesce(excluded.last_reboot_at, device_runtime_status.last_reboot_at),
          updated_at = now()
      returning
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        is_online as "isOnline",
        online_state as "onlineState",
        status_reason as "statusReason",
        last_seen_at::text as "lastSeenAt",
        last_heartbeat_at::text as "lastHeartbeatAt",
        last_snapshot_at::text as "lastSnapshotAt",
        last_register_at::text as "lastRegisterAt",
        last_recovered_at::text as "lastRecoveredAt",
        current_boot_session_id as "currentBootSessionId",
        current_uptime_sec as "currentUptimeSec",
        current_reset_cause as "currentResetCause",
        firmware_version as "firmwareVersion",
        hardware_rev as "hardwareRev",
        today_register_count as "todayRegisterCount",
        register_count_last_hour as "registerCountLastHour",
        register_alert_level as "registerAlertLevel",
        network_lost_count as "networkLostCount",
        power_loss_count as "powerLossCount",
        last_disconnect_reason as "lastDisconnectReason",
        last_disconnect_conn_age_ms as "lastDisconnectConnAgeMs",
        last_disconnect_last_tx_type as "lastDisconnectLastTxType",
        last_disconnect_signature as "lastDisconnectSignature",
        peer_close_suspect_streak as "peerCloseSuspectStreak",
        frequent_reboot_recovery_streak as "frequentRebootRecoveryStreak",
        health_flags_json as "healthFlags",
        last_offline_started_at::text as "lastOfflineStartedAt",
        last_offline_ended_at::text as "lastOfflineEndedAt",
        last_offline_duration_sec as "lastOfflineDurationSec",
        last_recover_msg_type as "lastRecoverMsgType",
        last_recover_boot_session_id as "lastRecoverBootSessionId",
        last_reboot_at::text as "lastRebootAt",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      `,
      [
        input.tenantId,
        input.deviceId,
        input.imei,
        input.isOnline,
        input.onlineState,
        input.statusReason,
        input.lastSeenAt,
        input.lastHeartbeatAt,
        input.lastSnapshotAt,
        input.lastRegisterAt,
        input.lastRecoveredAt,
        input.currentBootSessionId,
        input.currentUptimeSec,
        input.currentResetCause,
        input.firmwareVersion,
        input.hardwareRev,
        input.todayRegisterCount,
        input.registerCountLastHour,
        input.registerAlertLevel,
        input.networkLostCount,
        input.powerLossCount,
        input.lastDisconnectReason,
        input.lastDisconnectConnAgeMs,
        input.lastDisconnectLastTxType,
        input.lastDisconnectSignature,
        input.peerCloseSuspectStreak,
        input.frequentRebootRecoveryStreak,
        JSON.stringify(input.healthFlags ?? []),
        input.lastOfflineStartedAt,
        input.lastOfflineEndedAt,
        input.lastOfflineDurationSec,
        input.lastRecoverMsgType,
        input.lastRecoverBootSessionId,
        input.lastRebootAt
      ],
      client
    );

    return result.rows[0] ?? null;
  }

  async upsertRuntimeShadow(input: RuntimeShadowUpsertInput, client: PoolClient) {
    await this.db.query(
      `
      insert into device_runtime_shadow (
        tenant_id,
        device_id,
        imei,
        project_id,
        block_id,
        source_node_code,
        last_msg_id,
        last_seq_no,
        last_msg_type,
        last_device_ts,
        last_server_rx_ts,
        last_heartbeat_at,
        last_snapshot_at,
        last_event_at,
        connection_state,
        online_state,
        workflow_state,
        run_state,
        power_state,
        ready,
        config_version,
        firmware_family,
        firmware_version,
        signal_csq,
        signal_rsrp,
        battery_soc,
        battery_voltage,
        solar_voltage,
        alarm_codes_json,
        common_status_json,
        module_states_json,
        last_command_id
      )
      values (
        $1,
        $2::uuid,
        $3,
        $4::uuid,
        $5::uuid,
        $6,
        $7,
        $8,
        $9,
        $10::timestamptz,
        $11::timestamptz,
        $12::timestamptz,
        $13::timestamptz,
        $14::timestamptz,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27,
        $28,
        $29::jsonb,
        $30::jsonb,
        $31::jsonb,
        $32::uuid
      )
      on conflict (tenant_id, device_id) do update
      set imei = excluded.imei,
          project_id = coalesce(excluded.project_id, device_runtime_shadow.project_id),
          block_id = coalesce(excluded.block_id, device_runtime_shadow.block_id),
          source_node_code = coalesce(excluded.source_node_code, device_runtime_shadow.source_node_code),
          last_msg_id = coalesce(excluded.last_msg_id, device_runtime_shadow.last_msg_id),
          last_seq_no = coalesce(excluded.last_seq_no, device_runtime_shadow.last_seq_no),
          last_msg_type = coalesce(excluded.last_msg_type, device_runtime_shadow.last_msg_type),
          last_device_ts = coalesce(excluded.last_device_ts, device_runtime_shadow.last_device_ts),
          last_server_rx_ts = coalesce(excluded.last_server_rx_ts, device_runtime_shadow.last_server_rx_ts),
          last_heartbeat_at = coalesce(excluded.last_heartbeat_at, device_runtime_shadow.last_heartbeat_at),
          last_snapshot_at = coalesce(excluded.last_snapshot_at, device_runtime_shadow.last_snapshot_at),
          last_event_at = coalesce(excluded.last_event_at, device_runtime_shadow.last_event_at),
          connection_state = coalesce(excluded.connection_state, device_runtime_shadow.connection_state),
          online_state = coalesce(excluded.online_state, device_runtime_shadow.online_state),
          workflow_state = coalesce(excluded.workflow_state, device_runtime_shadow.workflow_state),
          run_state = coalesce(excluded.run_state, device_runtime_shadow.run_state),
          power_state = coalesce(excluded.power_state, device_runtime_shadow.power_state),
          ready = excluded.ready,
          config_version = coalesce(excluded.config_version, device_runtime_shadow.config_version),
          firmware_family = coalesce(excluded.firmware_family, device_runtime_shadow.firmware_family),
          firmware_version = coalesce(excluded.firmware_version, device_runtime_shadow.firmware_version),
          signal_csq = coalesce(excluded.signal_csq, device_runtime_shadow.signal_csq),
          signal_rsrp = coalesce(excluded.signal_rsrp, device_runtime_shadow.signal_rsrp),
          battery_soc = coalesce(excluded.battery_soc, device_runtime_shadow.battery_soc),
          battery_voltage = coalesce(excluded.battery_voltage, device_runtime_shadow.battery_voltage),
          solar_voltage = coalesce(excluded.solar_voltage, device_runtime_shadow.solar_voltage),
          alarm_codes_json = excluded.alarm_codes_json,
          common_status_json = excluded.common_status_json,
          module_states_json = case
            when jsonb_typeof(excluded.module_states_json) = 'array'
             and jsonb_array_length(excluded.module_states_json) > 0
              then excluded.module_states_json
            else device_runtime_shadow.module_states_json
          end,
          last_command_id = coalesce(excluded.last_command_id, device_runtime_shadow.last_command_id),
          updated_at = now()
      `,
      [
        input.tenantId,
        input.deviceId,
        input.imei,
        input.projectId,
        input.blockId,
        input.sourceNodeCode,
        input.lastMsgId,
        input.lastSeqNo,
        input.lastMsgType,
        input.lastDeviceTs,
        input.lastServerRxTs,
        input.lastHeartbeatAt,
        input.lastSnapshotAt,
        input.lastEventAt,
        input.connectionState,
        input.onlineState,
        input.workflowState,
        input.runState,
        input.powerState,
        input.ready,
        input.configVersion,
        input.firmwareFamily,
        input.firmwareVersion,
        input.signalCsq,
        input.signalRsrp,
        input.batterySoc,
        input.batteryVoltage,
        input.solarVoltage,
        JSON.stringify(input.alarmCodes ?? []),
        JSON.stringify(input.commonStatus ?? {}),
        JSON.stringify(input.moduleStates ?? []),
        input.lastCommandId
      ],
      client
    );
  }

  async upsertConnectionState(input: RuntimeConnectionStateUpsertInput, client: PoolClient) {
    await this.db.query(
      `
      insert into device_runtime_shadow (
        tenant_id,
        device_id,
        imei,
        project_id,
        block_id,
        source_node_code,
        connection_state,
        online_state,
        last_heartbeat_at,
        last_event_at,
        common_status_json,
        module_states_json,
        alarm_codes_json
      )
      values (
        $1,
        $2::uuid,
        $3,
        $4::uuid,
        $5::uuid,
        $6,
        $7,
        coalesce($8, 'offline'),
        $9::timestamptz,
        $10::timestamptz,
        $11::jsonb,
        $12::jsonb,
        $13::jsonb
      )
      on conflict (tenant_id, device_id) do update
      set imei = excluded.imei,
          project_id = coalesce(excluded.project_id, device_runtime_shadow.project_id),
          block_id = coalesce(excluded.block_id, device_runtime_shadow.block_id),
          source_node_code = coalesce(excluded.source_node_code, device_runtime_shadow.source_node_code),
          connection_state = excluded.connection_state,
          online_state = coalesce(excluded.online_state, device_runtime_shadow.online_state),
          last_heartbeat_at = coalesce(excluded.last_heartbeat_at, device_runtime_shadow.last_heartbeat_at),
          last_event_at = coalesce(excluded.last_event_at, device_runtime_shadow.last_event_at),
          updated_at = now()
      `,
      [
        input.tenantId,
        input.deviceId,
        input.imei,
        input.projectId,
        input.blockId,
        input.sourceNodeCode,
        input.connectionState,
        input.onlineState,
        input.lastHeartbeatAt,
        input.lastEventAt,
        EMPTY_OBJECT_JSON,
        EMPTY_ARRAY_JSON,
        EMPTY_ARRAY_JSON
      ],
      client
    );
  }

  async findRuntimeStatusByDeviceId(tenantId: string, deviceId: string, client?: PoolClient) {
    const result = await this.db.query<RuntimeStatusRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        is_online as "isOnline",
        online_state as "onlineState",
        status_reason as "statusReason",
        last_seen_at::text as "lastSeenAt",
        last_heartbeat_at::text as "lastHeartbeatAt",
        last_snapshot_at::text as "lastSnapshotAt",
        last_register_at::text as "lastRegisterAt",
        last_recovered_at::text as "lastRecoveredAt",
        current_boot_session_id as "currentBootSessionId",
        current_uptime_sec as "currentUptimeSec",
        current_reset_cause as "currentResetCause",
        firmware_version as "firmwareVersion",
        hardware_rev as "hardwareRev",
        today_register_count as "todayRegisterCount",
        register_count_last_hour as "registerCountLastHour",
        register_alert_level as "registerAlertLevel",
        network_lost_count as "networkLostCount",
        power_loss_count as "powerLossCount",
        last_disconnect_reason as "lastDisconnectReason",
        last_disconnect_conn_age_ms as "lastDisconnectConnAgeMs",
        last_disconnect_last_tx_type as "lastDisconnectLastTxType",
        last_disconnect_signature as "lastDisconnectSignature",
        peer_close_suspect_streak as "peerCloseSuspectStreak",
        frequent_reboot_recovery_streak as "frequentRebootRecoveryStreak",
        health_flags_json as "healthFlags",
        last_offline_started_at::text as "lastOfflineStartedAt",
        last_offline_ended_at::text as "lastOfflineEndedAt",
        last_offline_duration_sec as "lastOfflineDurationSec",
        last_recover_msg_type as "lastRecoverMsgType",
        last_recover_boot_session_id as "lastRecoverBootSessionId",
        last_reboot_at::text as "lastRebootAt",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_runtime_status
      where tenant_id = $1 and device_id = $2::uuid
      limit 1
      `,
      [tenantId, deviceId],
      client
    );
    return result.rows[0] ?? null;
  }

  async listRuntimeStatusesForSweep(tenantId: string, client?: PoolClient) {
    const result = await this.db.query<RuntimeStatusRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        is_online as "isOnline",
        online_state as "onlineState",
        status_reason as "statusReason",
        last_seen_at::text as "lastSeenAt",
        last_heartbeat_at::text as "lastHeartbeatAt",
        last_snapshot_at::text as "lastSnapshotAt",
        last_register_at::text as "lastRegisterAt",
        last_recovered_at::text as "lastRecoveredAt",
        current_boot_session_id as "currentBootSessionId",
        current_uptime_sec as "currentUptimeSec",
        current_reset_cause as "currentResetCause",
        firmware_version as "firmwareVersion",
        hardware_rev as "hardwareRev",
        today_register_count as "todayRegisterCount",
        register_count_last_hour as "registerCountLastHour",
        register_alert_level as "registerAlertLevel",
        network_lost_count as "networkLostCount",
        power_loss_count as "powerLossCount",
        last_disconnect_reason as "lastDisconnectReason",
        last_disconnect_conn_age_ms as "lastDisconnectConnAgeMs",
        last_disconnect_last_tx_type as "lastDisconnectLastTxType",
        last_disconnect_signature as "lastDisconnectSignature",
        peer_close_suspect_streak as "peerCloseSuspectStreak",
        frequent_reboot_recovery_streak as "frequentRebootRecoveryStreak",
        health_flags_json as "healthFlags",
        last_offline_started_at::text as "lastOfflineStartedAt",
        last_offline_ended_at::text as "lastOfflineEndedAt",
        last_offline_duration_sec as "lastOfflineDurationSec",
        last_recover_msg_type as "lastRecoverMsgType",
        last_recover_boot_session_id as "lastRecoverBootSessionId",
        last_reboot_at::text as "lastRebootAt",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_runtime_status
      where tenant_id = $1
      `,
      [tenantId],
      client
    );
    return result.rows;
  }

  async findOpenOfflineEvent(tenantId: string, deviceId: string, client?: PoolClient) {
    const result = await this.db.query<OfflineEventRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        offline_state as "offlineState",
        offline_started_at::text as "offlineStartedAt",
        offline_confirmed_at::text as "offlineConfirmedAt",
        offline_ended_at::text as "offlineEndedAt",
        offline_duration_sec as "offlineDurationSec",
        recover_msg_type as "recoverMsgType",
        recover_boot_session_id as "recoverBootSessionId",
        offline_start_boot_session_id as "offlineStartBootSessionId",
        status,
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_offline_events
      where tenant_id = $1 and device_id = $2::uuid and status = 'open'
      limit 1
      `,
      [tenantId, deviceId],
      client
    );
    return result.rows[0] ?? null;
  }

  async findLatestOfflineEvent(tenantId: string, deviceId: string, client?: PoolClient) {
    const result = await this.db.query<OfflineEventRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        offline_state as "offlineState",
        offline_started_at::text as "offlineStartedAt",
        offline_confirmed_at::text as "offlineConfirmedAt",
        offline_ended_at::text as "offlineEndedAt",
        offline_duration_sec as "offlineDurationSec",
        recover_msg_type as "recoverMsgType",
        recover_boot_session_id as "recoverBootSessionId",
        offline_start_boot_session_id as "offlineStartBootSessionId",
        status,
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_offline_events
      where tenant_id = $1 and device_id = $2::uuid
      order by offline_started_at desc
      limit 1
      `,
      [tenantId, deviceId],
      client
    );
    return result.rows[0] ?? null;
  }

  async listRecentRecoveredOfflineEvents(tenantId: string, deviceId: string, limit: number, client?: PoolClient) {
    const safeLimit = Math.min(Math.max(limit, 1), 20);
    const result = await this.db.query<OfflineEventRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        offline_state as "offlineState",
        offline_started_at::text as "offlineStartedAt",
        offline_confirmed_at::text as "offlineConfirmedAt",
        offline_ended_at::text as "offlineEndedAt",
        offline_duration_sec as "offlineDurationSec",
        recover_msg_type as "recoverMsgType",
        recover_boot_session_id as "recoverBootSessionId",
        offline_start_boot_session_id as "offlineStartBootSessionId",
        status,
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_offline_events
      where tenant_id = $1
        and device_id = $2::uuid
        and status = 'recovered'
      order by offline_ended_at desc nulls last
      limit $3
      `,
      [tenantId, deviceId, safeLimit],
      client
    );
    return result.rows;
  }

  async openOfflineEvent(input: {
    tenantId: string;
    deviceId: string;
    imei: string;
    offlineState: string;
    offlineStartedAt: string;
    offlineStartBootSessionId: string | null;
  }, client: PoolClient) {
    const inserted = await this.db.query<OfflineEventRow>(
      `
      insert into device_offline_events (
        tenant_id,
        device_id,
        imei,
        offline_state,
        offline_started_at,
        offline_start_boot_session_id,
        status
      )
      select $1, $2::uuid, $3, $4, $5::timestamptz, $6::varchar(128), 'open'
      where not exists (
        select 1
        from device_offline_events
        where tenant_id = $1
          and device_id = $2::uuid
          and status = 'open'
      )
      returning
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        offline_state as "offlineState",
        offline_started_at::text as "offlineStartedAt",
        offline_confirmed_at::text as "offlineConfirmedAt",
        offline_ended_at::text as "offlineEndedAt",
        offline_duration_sec as "offlineDurationSec",
        recover_msg_type as "recoverMsgType",
        recover_boot_session_id as "recoverBootSessionId",
        offline_start_boot_session_id as "offlineStartBootSessionId",
        status,
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      `,
      [
        input.tenantId,
        input.deviceId,
        input.imei,
        input.offlineState,
        input.offlineStartedAt,
        input.offlineStartBootSessionId
      ],
      client
    );
    if (inserted.rows[0]) {
      return inserted.rows[0];
    }

    const existing = await this.findOpenOfflineEvent(input.tenantId, input.deviceId, client);
    if (!existing) {
      return null;
    }

    const updated = await this.db.query<OfflineEventRow>(
      `
      update device_offline_events
      set offline_state = $2,
          offline_started_at = least(offline_started_at, $3::timestamptz),
          offline_start_boot_session_id = coalesce(offline_start_boot_session_id, $4),
          updated_at = now()
      where id = $1::uuid
      returning
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        offline_state as "offlineState",
        offline_started_at::text as "offlineStartedAt",
        offline_confirmed_at::text as "offlineConfirmedAt",
        offline_ended_at::text as "offlineEndedAt",
        offline_duration_sec as "offlineDurationSec",
        recover_msg_type as "recoverMsgType",
        recover_boot_session_id as "recoverBootSessionId",
        offline_start_boot_session_id as "offlineStartBootSessionId",
        status,
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      `,
      [existing.id, input.offlineState, input.offlineStartedAt, input.offlineStartBootSessionId],
      client
    );
    return updated.rows[0] ?? existing;
  }

  async confirmOfflineEvent(eventId: string, confirmedAt: string, client: PoolClient) {
    const result = await this.db.query<OfflineEventRow>(
      `
      update device_offline_events
      set offline_state = 'offline_confirmed',
          offline_confirmed_at = coalesce(offline_confirmed_at, $2::timestamptz),
          updated_at = now()
      where id = $1::uuid
      returning
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        offline_state as "offlineState",
        offline_started_at::text as "offlineStartedAt",
        offline_confirmed_at::text as "offlineConfirmedAt",
        offline_ended_at::text as "offlineEndedAt",
        offline_duration_sec as "offlineDurationSec",
        recover_msg_type as "recoverMsgType",
        recover_boot_session_id as "recoverBootSessionId",
        offline_start_boot_session_id as "offlineStartBootSessionId",
        status,
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      `,
      [eventId, confirmedAt],
      client
    );
    return result.rows[0] ?? null;
  }

  async closeOfflineEvent(input: {
    eventId: string;
    offlineEndedAt: string;
    offlineDurationSec: number;
    recoverMsgType: string | null;
    recoverBootSessionId: string | null;
  }, client: PoolClient) {
    const result = await this.db.query<OfflineEventRow>(
      `
      update device_offline_events
      set offline_ended_at = $2::timestamptz,
          offline_duration_sec = $3,
          recover_msg_type = $4,
          recover_boot_session_id = $5,
          status = 'recovered',
          updated_at = now()
      where id = $1::uuid
      returning
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        offline_state as "offlineState",
        offline_started_at::text as "offlineStartedAt",
        offline_confirmed_at::text as "offlineConfirmedAt",
        offline_ended_at::text as "offlineEndedAt",
        offline_duration_sec as "offlineDurationSec",
        recover_msg_type as "recoverMsgType",
        recover_boot_session_id as "recoverBootSessionId",
        offline_start_boot_session_id as "offlineStartBootSessionId",
        status,
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      `,
      [input.eventId, input.offlineEndedAt, input.offlineDurationSec, input.recoverMsgType, input.recoverBootSessionId],
      client
    );
    return result.rows[0] ?? null;
  }

  async insertRebootEvent(input: RebootEventInsertInput, client: PoolClient) {
    const result = await this.db.query<RebootEventRow>(
      `
      insert into device_reboot_events (
        tenant_id,
        device_id,
        imei,
        detected_at,
        reason_type,
        previous_boot_session_id,
        current_boot_session_id,
        previous_uptime_sec,
        current_uptime_sec,
        reset_cause,
        source_msg_type,
        source_msg_id
      )
      values ($1, $2::uuid, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11, $12)
      returning
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        detected_at::text as "detectedAt",
        reason_type as "reasonType",
        previous_boot_session_id as "previousBootSessionId",
        current_boot_session_id as "currentBootSessionId",
        previous_uptime_sec as "previousUptimeSec",
        current_uptime_sec as "currentUptimeSec",
        reset_cause as "resetCause",
        source_msg_type as "sourceMsgType",
        source_msg_id as "sourceMsgId",
        created_at::text as "createdAt"
      `,
      [
        input.tenantId,
        input.deviceId,
        input.imei,
        input.detectedAt,
        input.reasonType,
        input.previousBootSessionId,
        input.currentBootSessionId,
        input.previousUptimeSec,
        input.currentUptimeSec,
        input.resetCause,
        input.sourceMsgType,
        input.sourceMsgId
      ],
      client
    );
    return result.rows[0] ?? null;
  }

  async listRecentRebootEvents(tenantId: string, deviceId: string, limit = 10, client?: PoolClient) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const result = await this.db.query<RebootEventRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        detected_at::text as "detectedAt",
        reason_type as "reasonType",
        previous_boot_session_id as "previousBootSessionId",
        current_boot_session_id as "currentBootSessionId",
        previous_uptime_sec as "previousUptimeSec",
        current_uptime_sec as "currentUptimeSec",
        reset_cause as "resetCause",
        source_msg_type as "sourceMsgType",
        source_msg_id as "sourceMsgId",
        created_at::text as "createdAt"
      from device_reboot_events
      where tenant_id = $1 and device_id = $2::uuid
      order by detected_at desc
      limit $3
      `,
      [tenantId, deviceId, safeLimit],
      client
    );
    return result.rows;
  }

  async upsertDailyHealthDelta(
    input: {
      tenantId: string;
      deviceId: string;
      imei: string;
      day: string;
      offlineCountDelta?: number;
      offlineTotalSecDelta?: number;
      registerCountDelta?: number;
      rebootCountDelta?: number;
      peerCloseSuspectCountDelta?: number;
    },
    client: PoolClient
  ) {
    const result = await this.db.query<DeviceHealthDailyRow>(
      `
      with delta as (
        select
          $1::uuid as tenant_id,
          $2::uuid as device_id,
          $3::date as day,
          $4::varchar(32) as imei,
          $5::integer as offline_count_delta,
          $6::integer as offline_total_sec_delta,
          $7::integer as register_count_delta,
          $8::integer as reboot_count_delta,
          $9::integer as peer_close_suspect_count_delta
      )
      insert into device_health_daily (
        tenant_id,
        device_id,
        day,
        imei,
        offline_count,
        offline_total_sec,
        availability,
        register_count,
        reboot_count,
        peer_close_suspect_count
      )
      select
        delta.tenant_id,
        delta.device_id,
        delta.day,
        delta.imei,
        delta.offline_count_delta,
        delta.offline_total_sec_delta,
        greatest(0, least(1, 1 - (delta.offline_total_sec_delta::numeric / 86400.0))),
        delta.register_count_delta,
        delta.reboot_count_delta,
        delta.peer_close_suspect_count_delta
      from delta
      on conflict (tenant_id, device_id, day) do update
      set imei = excluded.imei,
          offline_count = device_health_daily.offline_count + excluded.offline_count,
          offline_total_sec = device_health_daily.offline_total_sec + excluded.offline_total_sec,
          register_count = device_health_daily.register_count + excluded.register_count,
          reboot_count = device_health_daily.reboot_count + excluded.reboot_count,
          peer_close_suspect_count = device_health_daily.peer_close_suspect_count + excluded.peer_close_suspect_count,
          availability = greatest(
            0,
            least(
              1,
              1 - ((device_health_daily.offline_total_sec + excluded.offline_total_sec)::numeric / 86400.0)
            )
          ),
          updated_at = now()
      returning
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        day::text as day,
        imei,
        offline_count as "offlineCount",
        offline_total_sec as "offlineTotalSec",
        availability::float8 as availability,
        register_count as "registerCount",
        reboot_count as "rebootCount",
        peer_close_suspect_count as "peerCloseSuspectCount",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      `,
      [
        input.tenantId,
        input.deviceId,
        input.day,
        input.imei,
        input.offlineCountDelta ?? 0,
        input.offlineTotalSecDelta ?? 0,
        input.registerCountDelta ?? 0,
        input.rebootCountDelta ?? 0,
        input.peerCloseSuspectCountDelta ?? 0
      ],
      client
    );
    return result.rows[0] ?? null;
  }

  async findDailyHealthByDay(tenantId: string, deviceId: string, day: string, client?: PoolClient) {
    const result = await this.db.query<DeviceHealthDailyRow>(
      `
      select
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        day::text as day,
        imei,
        offline_count as "offlineCount",
        offline_total_sec as "offlineTotalSec",
        availability::float8 as availability,
        register_count as "registerCount",
        reboot_count as "rebootCount",
        peer_close_suspect_count as "peerCloseSuspectCount",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_health_daily
      where tenant_id = $1 and device_id = $2::uuid and day = $3::date
      limit 1
      `,
      [tenantId, deviceId, day],
      client
    );
    return result.rows[0] ?? null;
  }

  async countRegisterEventsSince(tenantId: string, deviceId: string, sinceAt: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from device_message_log_v2
      where tenant_id = $1
        and device_id = $2::uuid
        and event_type = 'DEVICE_REGISTERED'
        and server_rx_ts >= $3::timestamptz
      `,
      [tenantId, deviceId, sinceAt],
      client
    );
    return result.rows[0]?.count ?? 0;
  }

  async replaceChannelLatest(
    tenantId: string,
    deviceId: string,
    rows: ChannelLatestUpsertInput[],
    client: PoolClient
  ) {
    await this.db.query(
      `
      delete from device_channel_latest
      where tenant_id = $1 and device_id = $2::uuid
      `,
      [tenantId, deviceId],
      client
    );

    await this.upsertChannelLatest(rows, client);
  }

  async upsertChannelLatest(rows: ChannelLatestUpsertInput[], client: PoolClient) {
    for (const row of rows) {
      await this.db.query(
        `
        insert into device_channel_latest (
          tenant_id,
          device_id,
          imei,
          project_id,
          block_id,
          source_node_code,
          module_code,
          module_instance_code,
          channel_code,
          metric_code,
          value_num,
          value_text,
          unit,
          quality,
          fault_codes_json,
          collected_at,
          server_rx_ts,
          last_msg_id,
          last_seq_no
        )
        values (
          $1,
          $2::uuid,
          $3,
          $4::uuid,
          $5::uuid,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15::jsonb,
          $16::timestamptz,
          $17::timestamptz,
          $18,
          $19
        )
        on conflict (tenant_id, imei, channel_code, metric_code) do update
        set device_id = excluded.device_id,
            project_id = coalesce(excluded.project_id, device_channel_latest.project_id),
            block_id = coalesce(excluded.block_id, device_channel_latest.block_id),
            source_node_code = coalesce(excluded.source_node_code, device_channel_latest.source_node_code),
            module_code = excluded.module_code,
            module_instance_code = coalesce(excluded.module_instance_code, device_channel_latest.module_instance_code),
            value_num = excluded.value_num,
            value_text = excluded.value_text,
            unit = coalesce(excluded.unit, device_channel_latest.unit),
            quality = coalesce(excluded.quality, device_channel_latest.quality),
            fault_codes_json = excluded.fault_codes_json,
            collected_at = coalesce(excluded.collected_at, device_channel_latest.collected_at),
            server_rx_ts = coalesce(excluded.server_rx_ts, device_channel_latest.server_rx_ts),
            last_msg_id = coalesce(excluded.last_msg_id, device_channel_latest.last_msg_id),
            last_seq_no = coalesce(excluded.last_seq_no, device_channel_latest.last_seq_no),
            updated_at = now()
        `,
        [
          row.tenantId,
          row.deviceId,
          row.imei,
          row.projectId,
          row.blockId,
          row.sourceNodeCode,
          row.moduleCode,
          row.moduleInstanceCode,
          row.channelCode,
          row.metricCode,
          row.valueNum,
          row.valueText,
          row.unit,
          row.quality,
          JSON.stringify(row.faultCodes ?? []),
          row.collectedAt,
          row.serverRxTs,
          row.lastMsgId,
          row.lastSeqNo
        ],
        client
      );
    }
  }

  async findRuntimeShadowByDeviceId(tenantId: string, deviceId: string, client?: PoolClient) {
    const result = await this.db.query<RuntimeShadowRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        project_id::text as "projectId",
        block_id::text as "blockId",
        source_node_code as "sourceNodeCode",
        last_msg_id as "lastMsgId",
        last_seq_no as "lastSeqNo",
        last_msg_type as "lastMsgType",
        last_device_ts::text as "lastDeviceTs",
        last_server_rx_ts::text as "lastServerRxTs",
        last_heartbeat_at::text as "lastHeartbeatAt",
        last_snapshot_at::text as "lastSnapshotAt",
        last_event_at::text as "lastEventAt",
        connection_state as "connectionState",
        online_state as "onlineState",
        workflow_state as "workflowState",
        run_state as "runState",
        power_state as "powerState",
        ready,
        config_version as "configVersion",
        firmware_family as "firmwareFamily",
        firmware_version as "firmwareVersion",
        signal_csq as "signalCsq",
        signal_rsrp as "signalRsrp",
        battery_soc::float8 as "batterySoc",
        battery_voltage::float8 as "batteryVoltage",
        solar_voltage::float8 as "solarVoltage",
        alarm_codes_json as "alarmCodes",
        common_status_json as "commonStatus",
        module_states_json as "moduleStates",
        last_command_id::text as "lastCommandId",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_runtime_shadow
      where tenant_id = $1 and device_id = $2::uuid
      limit 1
      `,
      [tenantId, deviceId],
      client
    );
    return result.rows[0] ?? null;
  }

  async findRuntimeShadowByImei(tenantId: string, imei: string, client?: PoolClient) {
    const result = await this.db.query<RuntimeShadowRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        project_id::text as "projectId",
        block_id::text as "blockId",
        source_node_code as "sourceNodeCode",
        last_msg_id as "lastMsgId",
        last_seq_no as "lastSeqNo",
        last_msg_type as "lastMsgType",
        last_device_ts::text as "lastDeviceTs",
        last_server_rx_ts::text as "lastServerRxTs",
        last_heartbeat_at::text as "lastHeartbeatAt",
        last_snapshot_at::text as "lastSnapshotAt",
        last_event_at::text as "lastEventAt",
        connection_state as "connectionState",
        online_state as "onlineState",
        workflow_state as "workflowState",
        run_state as "runState",
        power_state as "powerState",
        ready,
        config_version as "configVersion",
        firmware_family as "firmwareFamily",
        firmware_version as "firmwareVersion",
        signal_csq as "signalCsq",
        signal_rsrp as "signalRsrp",
        battery_soc::float8 as "batterySoc",
        battery_voltage::float8 as "batteryVoltage",
        solar_voltage::float8 as "solarVoltage",
        alarm_codes_json as "alarmCodes",
        common_status_json as "commonStatus",
        module_states_json as "moduleStates",
        last_command_id::text as "lastCommandId",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_runtime_shadow
      where tenant_id = $1 and imei = $2
      limit 1
      `,
      [tenantId, imei],
      client
    );
    return result.rows[0] ?? null;
  }

  async listRuntimeShadows(params: {
    tenantId: string;
    projectId?: string;
    blockId?: string;
    imei?: string;
    limit?: number;
  }) {
    const conds = ['tenant_id = $1'];
    const args: unknown[] = [params.tenantId];
    let p = 2;

    if (params.projectId) {
      conds.push(`project_id = $${p}::uuid`);
      args.push(params.projectId);
      p++;
    }
    if (params.blockId) {
      conds.push(`block_id = $${p}::uuid`);
      args.push(params.blockId);
      p++;
    }
    if (params.imei) {
      conds.push(`imei = $${p}`);
      args.push(params.imei);
      p++;
    }

    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    args.push(limit);

    const result = await this.db.query<RuntimeShadowRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        project_id::text as "projectId",
        block_id::text as "blockId",
        source_node_code as "sourceNodeCode",
        last_msg_id as "lastMsgId",
        last_seq_no as "lastSeqNo",
        last_msg_type as "lastMsgType",
        last_device_ts::text as "lastDeviceTs",
        last_server_rx_ts::text as "lastServerRxTs",
        last_heartbeat_at::text as "lastHeartbeatAt",
        last_snapshot_at::text as "lastSnapshotAt",
        last_event_at::text as "lastEventAt",
        connection_state as "connectionState",
        online_state as "onlineState",
        workflow_state as "workflowState",
        run_state as "runState",
        power_state as "powerState",
        ready,
        config_version as "configVersion",
        firmware_family as "firmwareFamily",
        firmware_version as "firmwareVersion",
        signal_csq as "signalCsq",
        signal_rsrp as "signalRsrp",
        battery_soc::float8 as "batterySoc",
        battery_voltage::float8 as "batteryVoltage",
        solar_voltage::float8 as "solarVoltage",
        alarm_codes_json as "alarmCodes",
        common_status_json as "commonStatus",
        module_states_json as "moduleStates",
        last_command_id::text as "lastCommandId",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_runtime_shadow
      where ${conds.join(' and ')}
      order by updated_at desc
      limit $${p}
      `,
      args
    );

    return result.rows;
  }

  async listChannelLatest(params: {
    tenantId: string;
    deviceId?: string;
    imei?: string;
    projectId?: string;
    blockId?: string;
    metricCode?: string;
    limit?: number;
  }, client?: PoolClient) {
    const conds = ['tenant_id = $1'];
    const args: unknown[] = [params.tenantId];
    let p = 2;

    if (params.deviceId) {
      conds.push(`device_id = $${p}::uuid`);
      args.push(params.deviceId);
      p++;
    }
    if (params.imei) {
      conds.push(`imei = $${p}`);
      args.push(params.imei);
      p++;
    }
    if (params.projectId) {
      conds.push(`project_id = $${p}::uuid`);
      args.push(params.projectId);
      p++;
    }
    if (params.blockId) {
      conds.push(`block_id = $${p}::uuid`);
      args.push(params.blockId);
      p++;
    }
    if (params.metricCode) {
      conds.push(`metric_code = $${p}`);
      args.push(params.metricCode);
      p++;
    }

    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    args.push(limit);

    const result = await this.db.query<ChannelLatestRow>(
      `
      select
        id::text as id,
        tenant_id::text as "tenantId",
        device_id::text as "deviceId",
        imei,
        project_id::text as "projectId",
        block_id::text as "blockId",
        source_node_code as "sourceNodeCode",
        module_code as "moduleCode",
        module_instance_code as "moduleInstanceCode",
        channel_code as "channelCode",
        metric_code as "metricCode",
        value_num::float8 as "valueNum",
        value_text as "valueText",
        unit,
        quality,
        fault_codes_json as "faultCodes",
        collected_at::text as "collectedAt",
        server_rx_ts::text as "serverRxTs",
        last_msg_id as "lastMsgId",
        last_seq_no as "lastSeqNo",
        updated_at::text as "updatedAt",
        created_at::text as "createdAt"
      from device_channel_latest
      where ${conds.join(' and ')}
      order by updated_at desc, channel_code asc, metric_code asc
      limit $${p}
      `,
      args,
      client
    );
    return result.rows;
  }
}
