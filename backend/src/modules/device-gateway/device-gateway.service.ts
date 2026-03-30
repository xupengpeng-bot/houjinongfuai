import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { DeviceEnvelope } from '../protocol-adapter/device-envelope';
import { DeviceRuntimeEvent } from '../protocol-adapter/device-runtime-event';
import { TcpJsonV1Adapter } from '../protocol-adapter/tcp-json-v1.adapter';
import { FarmerFundService } from '../farmer-fund/farmer-fund.service';
import { OrderRepository } from '../order/order.repository';
import { SessionStatusLogRepository } from '../runtime/session-status-log.repository';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_MANAGER_ID = '00000000-0000-0000-0000-000000000102';
const DEFAULT_OPERATOR_ID = '00000000-0000-0000-0000-000000000103';

type ResolvedDevice = {
  id: string;
  imei: string;
  deviceCode: string;
  deviceName: string | null;
  onlineState: string | null;
  runtimeState: string | null;
};

type ResolvedSession = {
  id: string;
  tenantId: string;
  sessionNo: string;
  sessionRef: string | null;
  status: string;
};

type ResolvedCommandDispatch = {
  id: string;
  sessionId: string;
  targetDeviceId: string;
  commandCode: string;
  dispatchStatus: string;
};

type ResolvedDeviceCommand = {
  id: string;
  commandToken: string;
  sessionId: string | null;
  targetDeviceId: string | null;
  commandCode: string;
  commandStatus: string;
  startToken: string | null;
  sessionRef: string | null;
  responsePayload: Record<string, unknown>;
};

type QueuedDeviceCommand = {
  id: string;
  commandToken: string;
  commandCode: string;
  commandStatus: string;
  targetDeviceId: string | null;
  imei: string;
  sessionId: string | null;
  sessionRef: string | null;
  startToken: string | null;
  sentAt: string | null;
  ackedAt: string | null;
  requestPayload: Record<string, unknown>;
};

type DeviceCommandQueueRow = {
  id: string;
  commandToken: string;
  commandCode: string;
  commandStatus: string;
  targetDeviceId: string | null;
  imei: string;
  sessionId: string | null;
  sessionRef: string | null;
  startToken: string | null;
  sentAt: string | null;
  ackedAt: string | null;
  failedAt: string | null;
  timeoutAt: string | null;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
};

type DeviceConnectionHealthRow = {
  id: string;
  imei: string;
  deviceCode: string;
  deviceName: string | null;
  onlineState: string | null;
  connectionState: string | null;
  runtimeState: string | null;
  lastHeartbeatAt: string | null;
  lastDeviceTs: string | null;
  activeSessionCount: number;
  affectedSessionRefs: string[];
  secondsSinceHeartbeat: number | null;
};

type ActiveRuntimeSession = {
  id: string;
  tenantId: string;
  sessionNo: string;
  sessionRef: string | null;
  status: string;
};

type OfflineWorkOrderPriority = 'high' | 'medium' | 'low';

type OfflineWorkOrderPolicy = {
  autoCreateWorkOrder: boolean;
  defaultPriority: OfflineWorkOrderPriority;
  defaultAssigneeUserId: string | null;
};

type GatewayRecoveryRecommendation = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  reason: string;
  suggestedAction: string;
  preferredEndpoint: string | null;
  stats: Record<string, unknown>;
};

@Injectable()
export class DeviceGatewayService {
  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
    private readonly adapter: TcpJsonV1Adapter,
    private readonly orderRepository: OrderRepository,
    private readonly sessionStatusLogRepository: SessionStatusLogRepository,
    private readonly farmerFundService: FarmerFundService
  ) {}

  getProtocolName() {
    return 'tcp-json-v1';
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

  private looksLikeUuid(value: string | null | undefined) {
    return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  }

  private toIsoTimestamp(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private normalizeBridgeId(value: unknown) {
    const normalized = this.asString(value).toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
    return normalized || 'default';
  }

  private buildBridgeConnectionId(bridgeId: string, imei: string) {
    return `bridge:${bridgeId}:${imei}`;
  }

  private getRetryLimit() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_RETRY_LIMIT') || 2);
    if (!Number.isFinite(raw)) return 2;
    return Math.min(Math.max(Math.trunc(raw), 0), 10);
  }

  private getSentTimeoutSeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_SENT_TIMEOUT_SECONDS') || 30);
    if (!Number.isFinite(raw)) return 30;
    return Math.min(Math.max(Math.trunc(raw), 5), 3600);
  }

  private getRetryBaseDelaySeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_RETRY_BASE_DELAY_SECONDS') || 15);
    if (!Number.isFinite(raw)) return 15;
    return Math.min(Math.max(Math.trunc(raw), 1), 3600);
  }

  private getRetryMaxDelaySeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_RETRY_MAX_DELAY_SECONDS') || 300);
    if (!Number.isFinite(raw)) return 300;
    return Math.min(Math.max(Math.trunc(raw), 1), 86400);
  }

  private getHeartbeatTimeoutSeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_HEARTBEAT_TIMEOUT_SECONDS') || 120);
    if (!Number.isFinite(raw)) return 120;
    return Math.min(Math.max(Math.trunc(raw), 10), 86400);
  }

  private getDisconnectGraceSeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_DISCONNECT_GRACE_SECONDS') || 30);
    if (!Number.isFinite(raw)) return 30;
    return Math.min(Math.max(Math.trunc(raw), 5), 3600);
  }

  private computeRetryDelaySeconds(retryCount: number) {
    const base = this.getRetryBaseDelaySeconds();
    const max = Math.max(base, this.getRetryMaxDelaySeconds());
    const exponent = Math.max(0, retryCount - 1);
    return Math.min(base * 2 ** exponent, max);
  }

  private computeNextRetryAt(retryCount: number, now = new Date()) {
    return new Date(now.getTime() + this.computeRetryDelaySeconds(retryCount) * 1000).toISOString();
  }

  private normalizeWorkOrderPriority(value: unknown): OfflineWorkOrderPriority {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
    return 'high';
  }

  getTransportPolicy() {
    return {
      retry_limit: this.getRetryLimit(),
      sent_timeout_seconds: this.getSentTimeoutSeconds(),
      heartbeat_timeout_seconds: this.getHeartbeatTimeoutSeconds(),
      disconnect_grace_seconds: this.getDisconnectGraceSeconds(),
      retry_base_delay_seconds: this.getRetryBaseDelaySeconds(),
      retry_max_delay_seconds: this.getRetryMaxDelaySeconds(),
      dead_letter_status: 'dead_letter',
      retry_pending_status: 'retry_pending'
    };
  }

  private getRetryCount(payload: Record<string, unknown> | null | undefined) {
    const transport = this.asObject(payload?.transport);
    return Math.max(0, this.asNumber(transport.retry_count) ?? 0);
  }

  private mergeTransportPayload(
    existingPayload: Record<string, unknown> | null | undefined,
    transportPatch: Record<string, unknown>
  ) {
    const current = this.asObject(existingPayload);
    const currentTransport = this.asObject(current.transport);
    return {
      ...current,
      transport: {
        ...currentTransport,
        ...transportPatch
      }
    };
  }

  private buildGatewayResponsePayload(event: DeviceRuntimeEvent, transportPatch?: Record<string, unknown>) {
    return {
      gateway_event_type: event.eventType,
      gateway_msg_id: event.msgId,
      gateway_seq_no: event.seqNo,
      gateway_payload: event.payload,
      gateway_received_at: event.serverRxTs,
      ...(transportPatch ? { transport: transportPatch } : {})
    };
  }

  private mergeGatewayResponsePayload(
    existingPayload: Record<string, unknown> | null | undefined,
    event: DeviceRuntimeEvent,
    transportPatch?: Record<string, unknown>
  ) {
    const current = this.asObject(existingPayload);
    return {
      ...current,
      ...this.buildGatewayResponsePayload(event),
      ...(transportPatch ? { transport: { ...this.asObject(current.transport), ...transportPatch } } : {})
    };
  }

  private resolveNackTransition(deviceCommand: ResolvedDeviceCommand, event: DeviceRuntimeEvent) {
    const payload = this.asObject(event.payload);
    const result = this.asString(payload.result).toLowerCase();
    const reason =
      this.asString(payload.reason_code) ||
      this.asString(payload.error_code) ||
      this.asString(payload.reason) ||
      this.asString(payload.message) ||
      'device_command_nack';
    const forceDeadLetter = this.asBoolean(payload.dead_letter) || result === 'dead_letter';
    const retryable =
      !forceDeadLetter &&
      (this.asBoolean(payload.retryable) ||
        this.asBoolean(payload.can_retry) ||
        this.asBoolean(payload.recoverable) ||
        result === 'retry');
    const retryCount = this.getRetryCount(deviceCommand.responsePayload);
    const nextRetryCount = retryable ? retryCount + 1 : retryCount;
    const canRetry = retryable && nextRetryCount <= this.getRetryLimit();
    const nextRetryAt = canRetry ? this.computeNextRetryAt(nextRetryCount) : null;
    const deviceCommandStatus = forceDeadLetter
      ? 'dead_letter'
      : canRetry
        ? 'retry_pending'
        : retryable
          ? 'dead_letter'
          : 'failed';
    const dispatchStatus = forceDeadLetter ? 'dead_letter' : canRetry ? 'retry_pending' : retryable ? 'dead_letter' : 'nack';

    return {
      deviceCommandStatus,
      dispatchStatus,
      transportPatch: {
        retry_count: nextRetryCount,
        retryable,
        nack_reason: reason,
        nack_result: result || 'nack',
        last_nack_at: this.toIsoTimestamp(event.serverRxTs) ?? new Date().toISOString(),
        retry_delay_seconds: canRetry ? this.computeRetryDelaySeconds(nextRetryCount) : null,
        next_retry_at: nextRetryAt,
        last_transition: forceDeadLetter
          ? 'device_nack_dead_letter'
          : canRetry
            ? 'device_nack_retry_pending'
            : retryable
              ? 'device_nack_dead_letter'
              : 'device_nack_failed',
        dead_letter_reason:
          forceDeadLetter || (retryable && !canRetry)
          ? reason
          : null
      }
    };
  }

  private buildValidatedEnvelope(input: Record<string, unknown>): DeviceEnvelope {
    const protocolVersion = this.asString(input.protocolVersion) || 'tcp-json-v1';
    const imei = this.asString(input.imei);
    const msgId = this.asString(input.msgId);
    const msgType = this.asString(input.msgType);
    const seqNo = this.asNumber(input.seqNo);

    if (!imei || !msgId || !msgType || seqNo === null) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'imei, msgId, msgType, and seqNo are required');
    }

    return {
      protocolVersion,
      imei,
      msgId,
      seqNo,
      msgType,
      deviceTs: this.toIsoTimestamp(this.asString(input.deviceTs)) ?? null,
      serverRxTs: this.toIsoTimestamp(this.asString(input.serverRxTs)) ?? new Date().toISOString(),
      sessionRef: this.asString(input.sessionRef) || null,
      runState: this.asString(input.runState) || null,
      powerState: this.asString(input.powerState) || null,
      alarmCodes: this.asStringArray(input.alarmCodes),
      cumulativeRuntimeSec: this.asNumber(input.cumulativeRuntimeSec),
      cumulativeEnergyWh: this.asNumber(input.cumulativeEnergyWh),
      cumulativeFlow: this.asNumber(input.cumulativeFlow),
      payload: this.asObject(input.payload),
      integrity: this.asObject(input.integrity)
    };
  }

  private async findDeviceByImei(imei: string, client: PoolClient) {
    const result = await this.db.query<ResolvedDevice>(
      `
      select
        id,
        imei,
        device_code as "deviceCode",
        device_name as "deviceName",
        online_state as "onlineState",
        runtime_state as "runtimeState"
      from device
      where tenant_id = $1 and imei = $2
      limit 1
      `,
      [TENANT_ID, imei],
      client
    );
    return result.rows[0] ?? null;
  }

  private async findDeviceById(deviceId: string, client: PoolClient) {
    if (!this.looksLikeUuid(deviceId)) return null;
    const result = await this.db.query<ResolvedDevice>(
      `
      select
        id,
        imei,
        device_code as "deviceCode",
        device_name as "deviceName",
        online_state as "onlineState",
        runtime_state as "runtimeState"
      from device
      where tenant_id = $1 and id = $2::uuid
      limit 1
      `,
      [TENANT_ID, deviceId],
      client
    );
    return result.rows[0] ?? null;
  }

  private async resolveSession(
    sessionRef: string | null | undefined,
    commandDispatchSessionId: string | null,
    client: PoolClient
  ) {
    if (sessionRef) {
      const byRef = await this.db.query<ResolvedSession>(
        `
        select
          id,
          tenant_id as "tenantId",
          session_no as "sessionNo",
          session_ref as "sessionRef",
          status
        from runtime_session
        where tenant_id = $1 and session_ref = $2
        limit 1
        `,
        [TENANT_ID, sessionRef],
        client
      );
      if (byRef.rows[0]) return byRef.rows[0];
    }

    if (!commandDispatchSessionId) return null;

    const byId = await this.db.query<ResolvedSession>(
      `
      select
        id,
        tenant_id as "tenantId",
        session_no as "sessionNo",
        session_ref as "sessionRef",
        status
      from runtime_session
      where id = $1::uuid
      limit 1
      `,
      [commandDispatchSessionId],
      client
    );
    return byId.rows[0] ?? null;
  }

  private async resolveCommandDispatchById(commandId: string | null | undefined, client: PoolClient) {
    if (!this.looksLikeUuid(commandId)) return null;
    const result = await this.db.query<ResolvedCommandDispatch>(
      `
      select
        id,
        session_id as "sessionId",
        target_device_id as "targetDeviceId",
        command_code as "commandCode",
        dispatch_status as "dispatchStatus"
      from command_dispatch
      where id = $1::uuid
      limit 1
      `,
      [commandId],
      client
    );
    return result.rows[0] ?? null;
  }

  private async resolveDeviceCommand(
    imei: string,
    commandToken: string | null | undefined,
    startToken: string | null | undefined,
    sessionRef: string | null | undefined,
    client: PoolClient
  ) {
    const normalizedCommandToken = this.asString(commandToken) || null;
    const normalizedStartToken = this.asString(startToken) || null;
    const normalizedSessionRef = this.asString(sessionRef) || null;

    if (!normalizedCommandToken && !normalizedStartToken && !normalizedSessionRef) return null;

    const result = await this.db.query<ResolvedDeviceCommand>(
      `
      select
        id,
        command_id::text as "commandToken",
        session_id as "sessionId",
        target_device_id as "targetDeviceId",
        command_code as "commandCode",
        command_status as "commandStatus",
        start_token as "startToken",
        session_ref as "sessionRef",
        response_payload_json as "responsePayload"
      from device_command
      where tenant_id = $1
        and imei = $2
        and (
          ($3::text is not null and command_id::text = $3)
          or ($4::text is not null and start_token = $4)
          or ($5::text is not null and session_ref = $5)
        )
      order by created_at desc
      limit 1
      `,
      [TENANT_ID, imei, normalizedCommandToken, normalizedStartToken, normalizedSessionRef],
      client
    );
    return result.rows[0] ?? null;
  }

  private async resolveCommandDispatchByToken(
    commandToken: string | null | undefined,
    startToken: string | null | undefined,
    sessionRef: string | null | undefined,
    deviceId: string | null,
    commandCode: string | null | undefined,
    client: PoolClient
  ) {
    if (!deviceId) return null;

    const normalizedCommandToken = this.asString(commandToken) || null;
    const normalizedStartToken = this.asString(startToken) || null;
    const normalizedSessionRef = this.asString(sessionRef) || null;
    const normalizedCommandCode = this.asString(commandCode).toLowerCase() || null;

    if (!normalizedCommandToken && !normalizedStartToken && !normalizedSessionRef) return null;

    const result = await this.db.query<ResolvedCommandDispatch>(
      `
      select
        id,
        session_id as "sessionId",
        target_device_id as "targetDeviceId",
        command_code as "commandCode",
        dispatch_status as "dispatchStatus"
      from command_dispatch
      where target_device_id = $1::uuid
        and (
          ($2::text is not null and (
            request_payload_json->>'device_command_token' = $2
            or request_payload_json->>'command_token' = $2
            or request_payload_json->>'device_command_id' = $2
            or request_payload_json->>'command_id' = $2
            or response_payload_json->>'device_command_token' = $2
            or response_payload_json->>'command_token' = $2
          ))
          or ($3::text is not null and (
            request_payload_json->>'start_token' = $3
            or response_payload_json->>'start_token' = $3
          ))
          or (
            $4::text is not null
            and $5::text is not null
            and lower(command_code) = $5
            and (
              request_payload_json->>'session_ref' = $4
              or response_payload_json->>'session_ref' = $4
            )
          )
        )
      order by created_at desc
      limit 1
      `,
      [deviceId, normalizedCommandToken, normalizedStartToken, normalizedSessionRef, normalizedCommandCode],
      client
    );
    return result.rows[0] ?? null;
  }

  private async resolveDeviceCommandByDispatch(commandDispatchId: string, client: PoolClient) {
    if (!this.looksLikeUuid(commandDispatchId)) return null;

    const result = await this.db.query<ResolvedDeviceCommand>(
      `
      select
        dc.id,
        dc.command_id::text as "commandToken",
        dc.session_id as "sessionId",
        dc.target_device_id as "targetDeviceId",
        dc.command_code as "commandCode",
        dc.command_status as "commandStatus",
        dc.start_token as "startToken",
        dc.session_ref as "sessionRef",
        dc.response_payload_json as "responsePayload"
      from command_dispatch cd
      join device_command dc
        on dc.tenant_id = cd.tenant_id
       and dc.target_device_id = cd.target_device_id
       and (
         (
           coalesce(
             cd.request_payload_json->>'device_command_token',
             cd.request_payload_json->>'command_token',
             cd.request_payload_json->>'device_command_id',
             cd.request_payload_json->>'command_id'
           ) is not null
           and dc.command_id::text = coalesce(
             cd.request_payload_json->>'device_command_token',
             cd.request_payload_json->>'command_token',
             cd.request_payload_json->>'device_command_id',
             cd.request_payload_json->>'command_id'
           )
         )
         or (
           cd.request_payload_json->>'start_token' is not null
           and dc.start_token = cd.request_payload_json->>'start_token'
         )
         or (
           dc.session_id = cd.session_id
           and lower(dc.command_code) = lower(cd.command_code)
         )
       )
      where cd.id = $1::uuid
      order by dc.created_at desc
      limit 1
      `,
      [commandDispatchId],
      client
    );
    return result.rows[0] ?? null;
  }

  private async resolveCommandDispatchFallback(
    sessionId: string | null,
    deviceId: string | null,
    payload: Record<string, unknown>,
    client: PoolClient
  ) {
    if (!sessionId || !deviceId) return null;
    const commandCode = this.asString(payload.command_code).toLowerCase();
    if (!commandCode) return null;

    const result = await this.db.query<ResolvedCommandDispatch>(
      `
      select
        id,
        session_id as "sessionId",
        target_device_id as "targetDeviceId",
        command_code as "commandCode",
        dispatch_status as "dispatchStatus"
      from command_dispatch
      where session_id = $1::uuid
        and target_device_id = $2::uuid
        and lower(command_code) = $3
      order by created_at desc
      limit 1
      `,
      [sessionId, deviceId, commandCode],
      client
    );
    return result.rows[0] ?? null;
  }

  private async insertMessageLog(event: DeviceRuntimeEvent, deviceId: string | null, client: PoolClient) {
    const inserted = await this.db.query<{ id: string }>(
      `
      insert into device_message_log (
        id, tenant_id, imei, device_id, connection_id, protocol_version, direction,
        msg_id, seq_no, msg_type, session_ref, command_id, device_ts, server_rx_ts,
        idempotency_key, ordering_key, integrity_ok, clock_drift_sec, payload_json
      )
      values (
        $1, $2, $3, $4::uuid, $5, $6, 'inbound',
        $7, $8, $9, $10, $11::uuid, $12::timestamptz, $13::timestamptz,
        $14, $15, true, $16, $17::jsonb
      )
      on conflict (tenant_id, idempotency_key) do nothing
      returning id
      `,
      [
        randomUUID(),
        TENANT_ID,
        event.imei,
        deviceId,
        `http:${event.imei}`,
        'tcp-json-v1',
        event.msgId,
        event.seqNo,
        event.msgType,
        event.sessionRef ?? null,
        this.looksLikeUuid(event.commandId) ? event.commandId : null,
        this.toIsoTimestamp(event.deviceTs ?? null),
        this.toIsoTimestamp(event.serverRxTs) ?? new Date().toISOString(),
        event.idempotencyKey,
        event.orderingKey,
        event.clockDriftSec ?? null,
        JSON.stringify({
          event_type: event.eventType,
          payload: event.payload,
          counters: event.counters
        })
      ],
      client
    );

    return {
      duplicate: inserted.rows.length === 0,
      id: inserted.rows[0]?.id ?? null
    };
  }

  private async touchDevice(device: ResolvedDevice, envelope: DeviceEnvelope, event: DeviceRuntimeEvent, client: PoolClient) {
    const onlineState = event.eventType === 'DEVICE_ALARM_RAISED' ? 'alarm' : 'online';
    const runtimeState =
      this.asString(envelope.runState) ||
      this.asString(event.payload.runtime_state) ||
      this.asString(event.payload.run_state) ||
      device.runtimeState ||
      'idle';

    await this.db.query(
      `
      update device
      set protocol_version = $2,
          last_device_ts = coalesce($3::timestamptz, last_device_ts),
          last_heartbeat_at = $4::timestamptz,
          online_state = $5,
          connection_state = 'connected',
          runtime_state = $6,
          updated_at = now()
      where id = $1::uuid
      `,
      [
        device.id,
        envelope.protocolVersion,
        this.toIsoTimestamp(envelope.deviceTs),
        this.toIsoTimestamp(envelope.serverRxTs) ?? new Date().toISOString(),
        onlineState,
        runtimeState
      ],
      client
    );
  }

  async bindConnectionSession(input: {
    imei?: string | null;
    connectionId?: string | null;
    transportType?: string | null;
    protocolVersion?: string | null;
    remoteAddr?: string | null;
    remotePort?: number | null;
  }) {
    const imei = this.asString(input.imei) || null;
    const connectionId = this.asString(input.connectionId) || null;
    if (!imei || !connectionId) return { bound: false, reason: 'missing_identity' as const };

    return this.db.withTransaction(async (client) => {
      const device = await this.findDeviceByImei(imei, client);
      if (!device) {
        return { bound: false, reason: 'device_not_found' as const, imei, connection_id: connectionId };
      }
      const recoveredAt = new Date().toISOString();

      await this.db.query(
        `
        update device_connection_session
        set disconnected_at = now(),
            connection_status = 'disconnected',
            superseded_by_connection_id = $3,
            updated_at = now()
        where tenant_id = $1
          and imei = $2
          and disconnected_at is null
          and connection_id <> $3
        `,
        [TENANT_ID, imei, connectionId],
        client
      );

      const existing = await this.db.query<{ id: string }>(
        `
        select id
        from device_connection_session
        where tenant_id = $1 and imei = $2 and connection_id = $3
        order by connected_at desc
        limit 1
        `,
        [TENANT_ID, imei, connectionId],
        client
      );

      if (existing.rows[0]) {
        await this.db.query(
          `
          update device_connection_session
          set device_id = $4::uuid,
              transport_type = $5,
              protocol_version = $6,
              remote_addr = $7,
              remote_port = $8,
              connection_status = 'connected',
              disconnected_at = null,
              updated_at = now(),
              audit_snapshot_json = coalesce(audit_snapshot_json, '{}'::jsonb) || $9::jsonb
          where id = $1::uuid and tenant_id = $2 and imei = $3
          `,
          [
            existing.rows[0].id,
            TENANT_ID,
            imei,
            device.id,
            this.asString(input.transportType) || 'tcp',
            this.asString(input.protocolVersion) || 'tcp-json-v1',
            this.asString(input.remoteAddr) || null,
            input.remotePort ?? null,
            JSON.stringify({
              last_seen_at: new Date().toISOString(),
              remote_addr: this.asString(input.remoteAddr) || null,
              remote_port: input.remotePort ?? null
            })
          ],
          client
        );
      } else {
        await this.db.query(
          `
          insert into device_connection_session (
            id, tenant_id, imei, device_id, connection_id, transport_type, protocol_version,
            remote_addr, remote_port, connection_status, connected_at, audit_snapshot_json
          )
          values (
            $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, 'connected', now(), $10::jsonb
          )
          `,
          [
            randomUUID(),
            TENANT_ID,
            imei,
            device.id,
            connectionId,
            this.asString(input.transportType) || 'tcp',
            this.asString(input.protocolVersion) || 'tcp-json-v1',
            this.asString(input.remoteAddr) || null,
            input.remotePort ?? null,
            JSON.stringify({
              remote_addr: this.asString(input.remoteAddr) || null,
              remote_port: input.remotePort ?? null
            })
          ],
          client
        );
      }

      await this.db.query(
        `
        update device
        set online_state = 'online',
            last_heartbeat_at = $2::timestamptz,
            connection_state = 'connected',
            updated_at = now()
        where id = $1::uuid
        `,
        [device.id, recoveredAt],
        client
      );

      const connectionRecovery = await this.handleConnectionRecovered(
        {
          ...device,
          onlineState: 'online'
        },
        {
          eventType: 'DEVICE_CONNECTION_RESTORED',
          msgId: connectionId,
          serverRxTs: recoveredAt
        },
        client
      );

      return {
        bound: true,
        imei,
        connection_id: connectionId,
        device_id: device.id,
        resolved_offline_alarm_ids: connectionRecovery.resolvedOfflineAlarmIds,
        auto_closed_work_order_ids: connectionRecovery.autoClosedOfflineWorkOrders.closedWorkOrderIds,
        resolved_offline_alarm_count: connectionRecovery.resolvedOfflineAlarmIds.length,
        auto_closed_work_order_count: connectionRecovery.autoClosedOfflineWorkOrders.closedCount,
        reactivated_retry_command_ids: connectionRecovery.reactivatedRetryCommands.commandIds,
        reactivated_retry_command_tokens: connectionRecovery.reactivatedRetryCommands.commandTokens,
        reactivated_retry_command_count: connectionRecovery.reactivatedRetryCommands.reactivatedCount,
        impacted_session_count: connectionRecovery.impactedSessionCount
      };
    });
  }

  async closeConnectionSession(connectionId: string | null | undefined) {
    const normalizedConnectionId = this.asString(connectionId);
    if (!normalizedConnectionId) {
      return { closed: false, reason: 'missing_connection_id' as const };
    }

    return this.db.withTransaction(async (client) => {
      const result = await this.db.query<{ imei: string; deviceId: string | null }>(
        `
        update device_connection_session
        set disconnected_at = coalesce(disconnected_at, now()),
            connection_status = 'disconnected',
            updated_at = now()
        where tenant_id = $1
          and connection_id = $2
          and disconnected_at is null
        returning imei, device_id as "deviceId"
        `,
        [TENANT_ID, normalizedConnectionId],
        client
      );

      if (!result.rows[0]) {
        return { closed: false, reason: 'not_found' as const, connection_id: normalizedConnectionId };
      }

      const imei = result.rows[0].imei;
      const active = await this.db.query<{ id: string }>(
        `
        select id
        from device_connection_session
        where tenant_id = $1 and imei = $2 and disconnected_at is null
        limit 1
        `,
        [TENANT_ID, imei],
        client
      );

      if (!active.rows[0] && result.rows[0].deviceId) {
        await this.db.query(
          `
          update device
          set connection_state = 'disconnected',
              updated_at = now()
          where id = $1::uuid
          `,
          [result.rows[0].deviceId],
          client
        );
      }

      return {
        closed: true,
        connection_id: normalizedConnectionId,
        imei,
        device_id: result.rows[0].deviceId
      };
    });
  }

  private buildTelemetryPatch(
    envelope: DeviceEnvelope,
    event: DeviceRuntimeEvent,
    commandDispatchId: string | null,
    commandToken: string | null
  ) {
    return {
      gateway: {
        last_event_type: event.eventType,
        last_msg_type: event.msgType,
        last_msg_id: event.msgId,
        last_seq_no: event.seqNo,
        last_server_rx_ts: event.serverRxTs,
        last_device_ts: event.deviceTs ?? null,
        last_command_id: event.commandId ?? null,
        last_command_token: commandToken,
        last_command_dispatch_id: commandDispatchId,
        last_start_token: event.startToken ?? null,
        last_run_state: envelope.runState ?? null,
        last_power_state: envelope.powerState ?? null,
        last_alarm_codes: envelope.alarmCodes ?? [],
        last_payload: event.payload
      },
      counters: {
        runtime_sec: event.counters.runtimeSec ?? null,
        energy_wh: event.counters.energyWh ?? null,
        flow: event.counters.flow ?? null
      }
    };
  }

  private async touchRuntimeSession(
    session: ResolvedSession,
    event: DeviceRuntimeEvent,
    envelope: DeviceEnvelope,
    commandDispatch: ResolvedCommandDispatch | null,
    commandToken: string | null,
    client: PoolClient
  ) {
    const telemetryPatch = this.buildTelemetryPatch(
      envelope,
      event,
      commandDispatch?.id ?? null,
      commandToken
    );
    const commandCode = commandDispatch?.commandCode?.toLowerCase() ?? this.asString(event.payload.command_code).toLowerCase();
    const isAck = event.eventType === 'DEVICE_COMMAND_ACKED';

    await this.db.query(
      `
      update runtime_session
      set session_ref = coalesce(session_ref, $2),
          device_acked_at = case when $3 then $4::timestamptz else device_acked_at end,
          last_event_at = $4::timestamptz,
          last_event_seq_no = $5,
          state_version = state_version + 1,
          start_command_id = case when $6 = 'start_session' and $7::uuid is not null then $7::uuid else start_command_id end,
          stop_command_id = case when $6 = 'stop_session' and $7::uuid is not null then $7::uuid else stop_command_id end,
          telemetry_snapshot_json = coalesce(telemetry_snapshot_json, '{}'::jsonb) || $8::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [
        session.id,
        event.sessionRef ?? null,
        isAck,
        this.toIsoTimestamp(event.serverRxTs) ?? new Date().toISOString(),
        event.seqNo,
        commandCode || null,
        commandDispatch?.id ?? null,
        JSON.stringify(telemetryPatch)
      ],
      client
    );

    if (event.eventType === 'DEVICE_COMMAND_ACKED' || event.eventType === 'DEVICE_COMMAND_NACKED' || event.eventType === 'DEVICE_RUNTIME_STOPPED') {
      await this.db.query(
        `
        insert into session_status_log (
          id, tenant_id, session_id, from_status, to_status, action_code,
          reason_code, reason_text, source, actor_id, snapshot_json
        )
        values (
          $1, $2, $3::uuid, $4, $4, $5,
          $6, $7, 'system', null, $8::jsonb
        )
        `,
        [
          randomUUID(),
          session.tenantId,
          session.id,
          session.status,
          event.eventType === 'DEVICE_RUNTIME_STOPPED'
            ? 'device_runtime_stopped_reported'
            : event.eventType === 'DEVICE_COMMAND_ACKED'
              ? 'device_command_acked'
              : 'device_command_nacked',
          event.eventType,
          `device gateway ingested ${event.eventType.toLowerCase()}`,
          JSON.stringify({
            imei: event.imei,
            msg_id: event.msgId,
            seq_no: event.seqNo,
            command_dispatch_id: commandDispatch?.id ?? null,
            payload: event.payload
          })
        ],
        client
      );
    }
  }

  private estimateSettledAmount(mode: string, unitPrice: number, minChargeAmount: number, durationSec: number) {
    if (mode === 'duration') {
      return Math.max(minChargeAmount, Math.ceil(durationSec / 60) * unitPrice);
    }
    if (mode === 'flat') {
      return Math.max(minChargeAmount, unitPrice);
    }
    if (mode === 'free') {
      return 0;
    }
    return Math.max(minChargeAmount, unitPrice);
  }

  private buildSettledPricingDetail(
    existingPricingDetail: Record<string, unknown>,
    pricingSnapshot: Record<string, unknown>,
    durationSec: number,
    finalAmount: number
  ) {
    const detail = existingPricingDetail as Record<string, any>;
    const previewFinalAmount = Number(detail.preview_final_amount ?? 0);

    return {
      ...detail,
      billing_mode: pricingSnapshot.mode,
      unit_price: Number(pricingSnapshot.unitPrice ?? 0),
      min_charge: Number(pricingSnapshot.minChargeAmount ?? 0),
      usage: {
        duration_seconds: durationSec
      },
      duration_seconds: durationSec,
      subtotal: finalAmount,
      final_amount: finalAmount,
      preview_delta_amount: finalAmount - previewFinalAmount,
      settled_at: new Date().toISOString(),
      settled_via: 'device_gateway_ack',
      effective_rule_snapshot_ref: {
        resolved_from:
          (pricingSnapshot as Record<string, any>).effectiveRuleSnapshot?.resolved_from ??
          detail.effective_rule_snapshot_ref?.resolved_from ??
          {}
      }
    };
  }

  private async completeStoppingSessionIfNeeded(
    session: ResolvedSession,
    event: DeviceRuntimeEvent,
    commandDispatch: ResolvedCommandDispatch | null,
    commandToken: string | null,
    client: PoolClient
  ) {
    const commandCode =
      commandDispatch?.commandCode?.toLowerCase() ??
      this.asString(event.payload.command_code).toLowerCase();
    const shouldComplete =
      session.status === 'stopping' &&
      (event.eventType === 'DEVICE_RUNTIME_STOPPED' ||
        (event.eventType === 'DEVICE_COMMAND_ACKED' && commandCode === 'stop_session'));

    if (!shouldComplete) {
      return null;
    }

    const endedAt = this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs) ?? new Date().toISOString();
    const endReasonCode =
      event.eventType === 'DEVICE_RUNTIME_STOPPED' ? 'device_runtime_stopped' : 'stop_command_acked';
    const stoppedResult = await this.db.query<{
      id: string;
      tenantId: string;
      userId: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      sessionRef: string | null;
      status: string;
      startedAt: string;
      endedAt: string;
    }>(
      `
      update runtime_session
      set status = 'ended',
          ended_at = coalesce(ended_at, $2::timestamptz),
          end_reason_code = $3,
          updated_at = now()
      where id = $1::uuid
        and status = 'stopping'
      returning
        id,
        tenant_id as "tenantId",
        user_id as "userId",
        well_id as "wellId",
        pump_id as "pumpId",
        valve_id as "valveId",
        session_ref as "sessionRef",
        status,
        started_at as "startedAt",
        ended_at as "endedAt"
      `,
      [session.id, endedAt, endReasonCode],
      client
    );

    const stopped = stoppedResult.rows[0] ?? null;
    if (!stopped) {
      return null;
    }

    await this.sessionStatusLogRepository.create(
      {
        tenantId: stopped.tenantId,
        sessionId: stopped.id,
        fromStatus: 'stopping',
        toStatus: 'ended',
        actionCode: 'stop_session_completed',
        reasonCode: event.eventType,
        reasonText: 'session stop completed after device acknowledgement',
        source: 'system',
        snapshot: {
          gateway_event_type: event.eventType,
          gateway_msg_id: event.msgId,
          gateway_seq_no: event.seqNo,
          command_dispatch_id: commandDispatch?.id ?? null,
          command_token: commandToken,
          session_ref: stopped.sessionRef ?? event.sessionRef ?? null,
          ended_at: stopped.endedAt
        }
      },
      client
    );

    const order = await this.orderRepository.findBySessionId(stopped.id, client);
    if (!order || order.status === 'settled') {
      return { stopped, order };
    }

    const startedAt = new Date(stopped.startedAt);
    const endedAtDate = new Date(stopped.endedAt);
    const durationSec = Math.max(1, Math.ceil((endedAtDate.getTime() - startedAt.getTime()) / 1000));
    const pricingSnapshot = (order.pricingSnapshot ?? {}) as Record<string, any>;
    const unitPrice = Number(pricingSnapshot.unitPrice ?? 0);
    const minChargeAmount = Number(pricingSnapshot.minChargeAmount ?? 0);
    const mode = String(pricingSnapshot.mode ?? 'duration');
    const amount = this.estimateSettledAmount(mode, unitPrice, minChargeAmount, durationSec);
    const finalized = await this.orderRepository.finalize(
      {
        orderId: order.id,
        chargeDurationSec: durationSec,
        amount,
        pricingSnapshot: {
          ...pricingSnapshot,
          breakdown: [
            { item: 'runtime_duration_seconds', value: durationSec },
            { item: 'amount', value: amount },
            { item: 'settled_via', value: 'device_gateway_ack' }
          ]
        },
        pricingDetail: this.buildSettledPricingDetail(order.pricingDetail ?? {}, pricingSnapshot, durationSec, amount)
      },
      client
    );

    await this.sessionStatusLogRepository.create(
      {
        tenantId: stopped.tenantId,
        sessionId: stopped.id,
        fromStatus: 'ended',
        toStatus: 'settled',
        actionCode: 'settle_success',
        reasonCode: 'ORDER_SETTLED',
        reasonText: 'irrigation order settled after device acknowledgement',
        source: 'system',
        snapshot: {
          orderId: order.id,
          finalAmount: finalized.amount,
          gateway_event_type: event.eventType,
          gateway_msg_id: event.msgId,
          session_ref: stopped.sessionRef ?? event.sessionRef ?? null
        }
      },
      client
    );

    await this.farmerFundService.debitForSettledOrder(client, {
      tenantId: order.tenantId,
      userId: order.userId,
      orderId: order.id,
      amount,
      fundingMode: order.fundingMode
    });

    return { stopped, order: finalized };
  }

  private async updateCommandDispatch(
    commandDispatch: ResolvedCommandDispatch,
    event: DeviceRuntimeEvent,
    deviceCommand: ResolvedDeviceCommand | null,
    client: PoolClient
  ) {
    const nackTransition =
      event.eventType === 'DEVICE_COMMAND_NACKED' && deviceCommand ? this.resolveNackTransition(deviceCommand, event) : null;
    const nextStatus =
      event.eventType === 'DEVICE_COMMAND_ACKED'
        ? 'acked'
        : event.eventType === 'DEVICE_COMMAND_NACKED'
          ? nackTransition?.dispatchStatus ?? 'nack'
          : commandDispatch.dispatchStatus;

    const result = await this.db.query<{ id: string; dispatchStatus: string; ackedAt: string | null }>(
      `
      update command_dispatch
      set dispatch_status = $2,
          acked_at = case when $3 then $4::timestamptz else acked_at end,
          sent_at = case when $5 then null else sent_at end,
          response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $6::jsonb
      where id = $1::uuid
      returning id, dispatch_status as "dispatchStatus", acked_at as "ackedAt"
      `,
      [
        commandDispatch.id,
        nextStatus,
        event.eventType === 'DEVICE_COMMAND_ACKED' || event.eventType === 'DEVICE_COMMAND_NACKED',
        this.toIsoTimestamp(event.serverRxTs) ?? new Date().toISOString(),
        nextStatus === 'retry_pending',
        JSON.stringify(this.buildGatewayResponsePayload(event, nackTransition?.transportPatch))
      ],
      client
    );
    return result.rows[0] ?? null;
  }

  private async updateDeviceCommand(
    deviceCommand: ResolvedDeviceCommand,
    event: DeviceRuntimeEvent,
    client: PoolClient
  ) {
    const nackTransition = event.eventType === 'DEVICE_COMMAND_NACKED' ? this.resolveNackTransition(deviceCommand, event) : null;
    const nextStatus =
      event.eventType === 'DEVICE_COMMAND_ACKED'
        ? 'acked'
        : event.eventType === 'DEVICE_COMMAND_NACKED'
          ? nackTransition?.deviceCommandStatus ?? 'failed'
          : deviceCommand.commandStatus;

    const result = await this.db.query<{
      id: string;
      commandStatus: string;
      ackedAt: string | null;
      failedAt: string | null;
    }>(
      `
        update device_command
        set command_status = $2,
            ack_msg_id = coalesce($3, ack_msg_id),
            ack_seq_no = coalesce($4, ack_seq_no),
            acked_at = case when $5 then $6::timestamptz else acked_at end,
            failed_at = case when $7 then $6::timestamptz when $8 then null else failed_at end,
            timeout_at = case when $9 then null else timeout_at end,
            sent_at = case when $10 then null else sent_at end,
            response_payload_json = $11::jsonb,
            updated_at = now()
        where id = $1::uuid
        returning
          id,
        command_status as "commandStatus",
        acked_at as "ackedAt",
        failed_at as "failedAt"
      `,
      [
        deviceCommand.id,
        nextStatus,
        event.msgId,
        event.seqNo,
        event.eventType === 'DEVICE_COMMAND_ACKED',
        this.toIsoTimestamp(event.serverRxTs) ?? new Date().toISOString(),
        nextStatus === 'failed' || nextStatus === 'dead_letter',
        nextStatus === 'retry_pending',
        nextStatus === 'retry_pending',
        nextStatus === 'retry_pending',
        JSON.stringify(this.mergeGatewayResponsePayload(deviceCommand.responsePayload, event, nackTransition?.transportPatch))
      ],
      client
    );

    return result.rows[0] ?? null;
  }

  private async createAlarm(deviceId: string, sessionId: string | null, event: DeviceRuntimeEvent, client: PoolClient) {
    const severity = this.asString(event.payload.severity).toLowerCase();
    const normalizedSeverity =
      severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low'
        ? severity
        : 'high';
    const alarmCode =
      this.asString(event.payload.alarm_code) ||
      this.asString(event.payload.code) ||
      'DEVICE_RUNTIME_ALARM';

    const inserted = await this.db.query<{ id: string }>(
      `
      insert into alarm_event (
        id, tenant_id, alarm_code, source_type, source_id, device_id, session_id,
        severity, status, trigger_reason_json, auto_create_work_order
      )
      values (
        $1, $2, $3, 'device', $4::uuid, $4::uuid, $5::uuid,
        $6, 'open', $7::jsonb, $8
      )
      returning id
      `,
      [
        randomUUID(),
        TENANT_ID,
        alarmCode,
        deviceId,
        sessionId,
        normalizedSeverity,
        JSON.stringify({
          event_type: event.eventType,
          msg_id: event.msgId,
          payload: event.payload
        }),
        normalizedSeverity === 'high' || normalizedSeverity === 'critical'
      ],
      client
    );
    return inserted.rows[0] ?? null;
  }

  private async listActiveSessionsByDeviceImei(imei: string, client: PoolClient) {
    const result = await this.db.query<ActiveRuntimeSession>(
      `
      select
        rs.id,
        rs.tenant_id as "tenantId",
        rs.session_no as "sessionNo",
        rs.session_ref as "sessionRef",
        rs.status
      from runtime_session rs
      where rs.tenant_id = $1
        and rs.device_key = $2
        and rs.status in ('pending_start', 'running', 'billing', 'stopping')
      order by rs.updated_at desc, rs.created_at desc
      `,
      [TENANT_ID, imei],
      client
    );
    return result.rows;
  }

  private async resolveDefaultAssigneeUserId(client: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from sys_user
      where tenant_id = $1
        and status = 'active'
        and id in ($2::uuid, $3::uuid)
      order by case id
        when $2::uuid then 0
        when $3::uuid then 1
        else 2
      end
      limit 1
      `,
      [TENANT_ID, DEFAULT_OPERATOR_ID, DEFAULT_MANAGER_ID],
      client
    );
    return result.rows[0]?.id ?? null;
  }

  private async getOfflineWorkOrderPolicy(client: PoolClient): Promise<OfflineWorkOrderPolicy> {
    const result = await this.db.query<{ promptJson: Record<string, unknown> | null }>(
      `
      select prompt_json as "promptJson"
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'alert_rules'
      order by updated_at desc
      limit 1
      `,
      [TENANT_ID],
      client
    );

    const prompt = this.asObject(result.rows[0]?.promptJson);
    const autoCreateWorkOrder =
      typeof prompt.autoCreateWorkOrder === 'boolean' ? prompt.autoCreateWorkOrder : true;

    return {
      autoCreateWorkOrder,
      defaultPriority: this.normalizeWorkOrderPriority(prompt.defaultWorkOrderPriority),
      defaultAssigneeUserId: await this.resolveDefaultAssigneeUserId(client)
    };
  }

  private computeOfflineWorkOrderDeadline(priority: OfflineWorkOrderPriority) {
    const hours = priority === 'high' ? 2 : priority === 'medium' ? 4 : 8;
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  private async generateWorkOrderNo(client: PoolClient) {
    const stamp = await this.db.query<{ workOrderNo: string }>(
      `
      select 'WO-HJ-' || to_char(now() at time zone 'Asia/Shanghai', 'YYYYMMDDHH24MISSMS') as "workOrderNo"
      `,
      [],
      client
    );
    return stamp.rows[0].workOrderNo;
  }

  private async insertWorkOrderActionLog(
    workOrderId: string,
    actionCode: string,
    fromStatus: string | null,
    toStatus: string,
    operatorId: string,
    remark: string,
    client: PoolClient
  ) {
    await this.db.query(
      `
      insert into work_order_action_log (
        tenant_id,
        work_order_id,
        action_code,
        from_status,
        to_status,
        operator_id,
        remark
      ) values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [TENANT_ID, workOrderId, actionCode, fromStatus, toStatus, operatorId, remark],
      client
    );
  }

  private async createOrRefreshOfflineWorkOrder(
    alarmId: string,
    device: ResolvedDevice,
    activeSessions: ActiveRuntimeSession[],
    heartbeatTimeoutSeconds: number,
    policy: OfflineWorkOrderPolicy,
    client: PoolClient
  ) {
    if (activeSessions.length === 0 || !policy.autoCreateWorkOrder) {
      return null;
    }

    const existing = await this.db.query<{
      id: string;
      status: string;
      assigneeUserId: string | null;
      workOrderNo: string;
    }>(
      `
      select
        id,
        status,
        assignee_user_id as "assigneeUserId",
        work_order_no as "workOrderNo"
      from work_order
      where tenant_id = $1
        and source_alarm_id = $2::uuid
        and work_order_type = 'device_offline'
        and status in ('created', 'assigned', 'in_progress')
      order by created_at desc
      limit 1
      `,
      [TENANT_ID, alarmId],
      client
    );

    const priority = policy.defaultPriority;
    const assigneeUserId = policy.defaultAssigneeUserId;
    const session = activeSessions[0];
    const title = `${device.deviceName ?? device.deviceCode} 设备离线处置`;
    const snapshot = {
      title,
      priority,
      auto_generated: true,
      auto_source: 'device_gateway_offline',
      heartbeat_timeout_seconds: heartbeatTimeoutSeconds,
      active_session_refs: activeSessions.map((item) => item.sessionRef ?? item.sessionNo),
      device_code: device.deviceCode,
      device_name: device.deviceName,
      device_imei: device.imei,
      alarm_id: alarmId
    };

    if (existing.rows[0]) {
      const current = existing.rows[0];
      const nextStatus =
        current.status === 'created' && assigneeUserId ? 'assigned' : current.status;

      await this.db.query(
        `
        update work_order
        set assignee_user_id = coalesce(assignee_user_id, $3::uuid),
            status = $4::varchar,
            result_json = coalesce(result_json, '{}'::jsonb) || $5::jsonb,
            updated_at = now()
        where id = $1::uuid
          and tenant_id = $2
        `,
        [
          current.id,
          TENANT_ID,
          assigneeUserId,
          nextStatus,
          JSON.stringify({
            ...snapshot,
            refreshed_at: new Date().toISOString(),
            work_order_no: current.workOrderNo
          })
        ],
        client
      );

      if (current.status === 'created' && nextStatus === 'assigned' && assigneeUserId) {
        await this.insertWorkOrderActionLog(
          current.id,
          'assign',
          'created',
          'assigned',
          DEFAULT_MANAGER_ID,
          'auto assigned for high-risk device offline incident',
          client
        );
      }

      return {
        id: current.id,
        created: false,
        autoAssigned: current.status === 'created' && nextStatus === 'assigned',
        workOrderNo: current.workOrderNo,
        status: nextStatus
      };
    }

    const workOrderId = randomUUID();
    const workOrderNo = await this.generateWorkOrderNo(client);
    const initialStatus = assigneeUserId ? 'assigned' : 'created';

    await this.db.query(
      `
      insert into work_order (
        id,
        tenant_id,
        work_order_no,
        source_alarm_id,
        source_session_id,
        device_id,
        work_order_type,
        status,
        assignee_user_id,
        sla_deadline_at,
        result_json
      ) values (
        $1::uuid,
        $2,
        $3,
        $4::uuid,
        $5::uuid,
        $6::uuid,
        'device_offline',
        $7::varchar,
        $8::uuid,
        $9::timestamptz,
        $10::jsonb
      )
      `,
      [
        workOrderId,
        TENANT_ID,
        workOrderNo,
        alarmId,
        session.id,
        device.id,
        initialStatus,
        assigneeUserId,
        this.computeOfflineWorkOrderDeadline(priority),
        JSON.stringify({
          ...snapshot,
          work_order_no: workOrderNo,
          created_at: new Date().toISOString()
        })
      ],
      client
    );

    await this.insertWorkOrderActionLog(
      workOrderId,
      'create',
      null,
      'created',
      DEFAULT_MANAGER_ID,
      'auto created for high-risk device offline incident',
      client
    );

    if (initialStatus === 'assigned' && assigneeUserId) {
      await this.insertWorkOrderActionLog(
        workOrderId,
        'assign',
        'created',
        'assigned',
        DEFAULT_MANAGER_ID,
        'auto assigned for high-risk device offline incident',
        client
      );
    }

    return {
      id: workOrderId,
      created: true,
      autoAssigned: initialStatus === 'assigned',
      workOrderNo,
      status: initialStatus
    };
  }

  private async markAlarmProcessingForWorkOrder(
    alarmId: string,
    workOrder: { id: string; workOrderNo: string; status: string },
    client: PoolClient
  ) {
    await this.db.query(
      `
      update alarm_event
      set status = case when status in ('open', 'pending') then 'processing' else status end,
          auto_create_work_order = true,
          trigger_reason_json = coalesce(trigger_reason_json, '{}'::jsonb) || $3::jsonb,
          updated_at = now()
      where tenant_id = $1
        and id = $2::uuid
      `,
      [
        TENANT_ID,
        alarmId,
        JSON.stringify({
          auto_work_order_id: workOrder.id,
          auto_work_order_no: workOrder.workOrderNo,
          auto_work_order_status: workOrder.status,
          auto_work_order_marked_at: new Date().toISOString()
        })
      ],
      client
    );
  }

  private async autoCloseOfflineWorkOrders(
    alarmIds: string[],
    resolution: { eventType: string; msgId: string; serverRxTs: string | null },
    client: PoolClient
  ) {
    if (alarmIds.length === 0) {
      return { closedCount: 0, closedWorkOrderIds: [] as string[] };
    }

    const result = await this.db.query<{ id: string; status: string }>(
      `
      select id, status
      from work_order
      where tenant_id = $1
        and source_alarm_id = any($2::uuid[])
        and work_order_type = 'device_offline'
        and status in ('created', 'assigned')
      `,
      [TENANT_ID, alarmIds],
      client
    );

    const closedWorkOrderIds: string[] = [];
    for (const row of result.rows) {
      await this.db.query(
        `
        update work_order
        set status = 'closed',
            result_json = coalesce(result_json, '{}'::jsonb) || $3::jsonb,
            updated_at = now()
        where tenant_id = $1
          and id = $2::uuid
        `,
        [
          TENANT_ID,
          row.id,
          JSON.stringify({
            auto_closed: true,
            auto_closed_reason: 'device connection restored before manual handling',
            auto_closed_at: resolution.serverRxTs ?? new Date().toISOString(),
            recovery_event_type: resolution.eventType,
            recovery_msg_id: resolution.msgId
          })
        ],
        client
      );

      await this.insertWorkOrderActionLog(
        row.id,
        'auto_close',
        row.status,
        'closed',
        DEFAULT_MANAGER_ID,
        'auto closed after device heartbeat recovery',
        client
      );
      closedWorkOrderIds.push(row.id);
    }

    return { closedCount: closedWorkOrderIds.length, closedWorkOrderIds };
  }

  async connectBridge(input: {
    imei?: string | null;
    bridge_id?: string | null;
    protocol_version?: string | null;
    remote_addr?: string | null;
    remote_port?: number | null;
  }) {
    const imei = this.asString(input.imei);
    const bridgeId = this.normalizeBridgeId(input.bridge_id);
    const connectionId = this.buildBridgeConnectionId(bridgeId, imei);

    const result = await this.bindConnectionSession({
      imei,
      connectionId,
      transportType: 'http_bridge',
      protocolVersion: this.asString(input.protocol_version) || 'http-json-v1',
      remoteAddr: this.asString(input.remote_addr) || 'http-bridge',
      remotePort: input.remote_port ?? null
    });

    return {
      bridge_id: bridgeId,
      connection_id: connectionId,
      ...result
    };
  }

  async heartbeatBridge(input: {
    imei?: string | null;
    bridge_id?: string | null;
    session_ref?: string | null;
    msg_id?: string | null;
    seq_no?: number | null;
    device_ts?: string | null;
    remote_addr?: string | null;
    remote_port?: number | null;
    dispatch_pending_commands?: boolean | null;
    mark_sent?: boolean | null;
    include_sent?: boolean | null;
    limit?: number | null;
    payload?: Record<string, unknown>;
  }) {
    const imei = this.asString(input.imei);
    if (!imei) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'imei is required');
    }

    const bridgeId = this.normalizeBridgeId(input.bridge_id);
    const connection = await this.connectBridge({
      imei,
      bridge_id: bridgeId,
      protocol_version: 'http-json-v1',
      remote_addr: input.remote_addr,
      remote_port: input.remote_port
    });

    const event = await this.ingestRuntimeEvent({
      protocolVersion: 'http-json-v1',
      imei,
      msgId: this.asString(input.msg_id) || `bridge-heartbeat-${bridgeId}-${Date.now()}`,
      msgType: 'HEARTBEAT',
      seqNo: input.seq_no ?? Number(String(Date.now()).slice(-6)),
      deviceTs: this.toIsoTimestamp(this.asString(input.device_ts)) ?? new Date().toISOString(),
      serverRxTs: new Date().toISOString(),
      sessionRef: this.asString(input.session_ref) || null,
      payload: {
        bridge_id: bridgeId,
        transport_mode: 'http_bridge',
        ...(this.asObject(input.payload))
      }
    });

    const connectionRecovery = this.asObject(connection);
    const eventRecovery = this.asObject(this.asObject(event).recovery);
    const mergedRecovery = {
      resolved_offline_alarm_ids: Array.from(
        new Set([
          ...this.asStringArray(connectionRecovery.resolved_offline_alarm_ids),
          ...this.asStringArray(eventRecovery.resolved_offline_alarm_ids)
        ])
      ),
      reactivated_retry_command_ids: Array.from(
        new Set([
          ...this.asStringArray(connectionRecovery.reactivated_retry_command_ids),
          ...this.asStringArray(eventRecovery.reactivated_retry_command_ids)
        ])
      ),
      reactivated_retry_command_tokens: Array.from(
        new Set([
          ...this.asStringArray(connectionRecovery.reactivated_retry_command_tokens),
          ...this.asStringArray(eventRecovery.reactivated_retry_command_tokens)
        ])
      )
    };

    const dispatchPendingCommands =
      input.dispatch_pending_commands === undefined ? true : this.asBoolean(input.dispatch_pending_commands);
    const pendingCommandDelivery = dispatchPendingCommands
      ? await this.pullPendingCommands({
          imei,
          session_ref: this.asString(input.session_ref) || undefined,
          limit: input.limit ?? undefined,
          mark_sent: input.mark_sent === undefined ? true : this.asBoolean(input.mark_sent),
          include_sent: this.asBoolean(input.include_sent)
        })
      : null;

    return {
      bridge_id: bridgeId,
      connection_id: connection.connection_id,
      connection,
      event: {
        ...event,
        recovery: mergedRecovery
      },
      pending_commands: pendingCommandDelivery?.items ?? [],
      pending_queue_total: pendingCommandDelivery?.total ?? 0,
      pending_command_delivery: pendingCommandDelivery
        ? {
            enabled: true,
            mark_sent: input.mark_sent === undefined ? true : this.asBoolean(input.mark_sent),
            include_sent: this.asBoolean(input.include_sent),
            queue_mode: pendingCommandDelivery.queue_mode
          }
        : {
            enabled: false,
            mark_sent: false,
            include_sent: false,
            queue_mode: null
          }
    };
  }

  async disconnectBridge(input: {
    bridge_id?: string | null;
    imei?: string | null;
    connection_id?: string | null;
  }) {
    const explicitConnectionId = this.asString(input.connection_id);
    const imei = this.asString(input.imei);
    const bridgeId = this.normalizeBridgeId(input.bridge_id);
    const connectionId = explicitConnectionId || (imei ? this.buildBridgeConnectionId(bridgeId, imei) : '');

    const result = await this.closeConnectionSession(connectionId);
    return {
      bridge_id: bridgeId,
      connection_id: connectionId || null,
      ...result
    };
  }

  private buildConnectionRecoveryTransportPatch(recovery: {
    eventType: string;
    msgId: string;
    serverRxTs: string | null;
  }) {
    const recoveredAt = recovery.serverRxTs ?? new Date().toISOString();
    return {
      retry_delay_seconds: 0,
      next_retry_at: recoveredAt,
      last_transition: 'connection_recovered_requeue',
      connection_recovered_at: recoveredAt,
      recovery_event_type: recovery.eventType,
      recovery_msg_id: recovery.msgId,
      dead_letter_reason: null
    };
  }

  private async reactivateRetryPendingCommands(
    imei: string,
    recovery: { eventType: string; msgId: string; serverRxTs: string | null },
    client: PoolClient
  ) {
    const result = await this.db.query<DeviceCommandQueueRow>(
      `
      select
        dc.id,
        dc.command_id::text as "commandToken",
        dc.command_code as "commandCode",
        dc.command_status as "commandStatus",
        dc.target_device_id as "targetDeviceId",
        dc.imei,
        dc.session_id as "sessionId",
        dc.session_ref as "sessionRef",
        dc.start_token as "startToken",
        dc.sent_at as "sentAt",
        dc.acked_at as "ackedAt",
        dc.failed_at as "failedAt",
        dc.timeout_at as "timeoutAt",
        dc.request_payload_json as "requestPayload",
        dc.response_payload_json as "responsePayload"
      from device_command dc
      where dc.tenant_id = $1
        and dc.imei = $2
        and dc.command_status = 'retry_pending'
      order by dc.created_at asc
      limit 100
      `,
      [TENANT_ID, imei],
      client
    );

    if (result.rows.length === 0) {
      return {
        reactivatedCount: 0,
        commandIds: [] as string[],
        commandTokens: [] as string[]
      };
    }

    const transportPatch = this.buildConnectionRecoveryTransportPatch(recovery);
    const commandIds: string[] = [];
    const commandTokens: string[] = [];

    for (const row of result.rows) {
      await this.db.query(
        `
        update device_command
        set command_status = 'created',
            sent_at = null,
            acked_at = null,
            failed_at = null,
            timeout_at = null,
            response_payload_json = $2::jsonb,
            updated_at = now()
        where id = $1::uuid
        `,
        [row.id, JSON.stringify(this.mergeTransportPayload(row.responsePayload, transportPatch))],
        client
      );

      await this.updateDispatchStatusByCommandToken(row.commandToken, 'created', transportPatch, client);
      commandIds.push(row.id);
      commandTokens.push(row.commandToken);
    }

    return {
      reactivatedCount: commandIds.length,
      commandIds,
      commandTokens
    };
  }

  private async createOrRefreshOfflineAlarm(
    device: ResolvedDevice,
    activeSessions: ActiveRuntimeSession[],
    heartbeatTimeoutSeconds: number,
    client: PoolClient
  ) {
    const existing = await this.db.query<{ id: string }>(
      `
      select id
      from alarm_event
      where tenant_id = $1
        and device_id = $2::uuid
        and alarm_code = 'DEVICE_OFFLINE'
        and status in ('open', 'pending', 'processing')
      order by created_at desc
      limit 1
      `,
      [TENANT_ID, device.id],
      client
    );

    const severity = activeSessions.length > 0 ? 'high' : 'medium';
    const sessionId = activeSessions[0]?.id ?? null;
    const triggerReason = {
      event_type: 'DEVICE_CONNECTION_STALE',
      message:
        activeSessions.length > 0
          ? `device heartbeat stale; ${activeSessions.length} active session(s) impacted`
          : 'device heartbeat stale; operator confirmation required',
      heartbeat_timeout_seconds: heartbeatTimeoutSeconds,
      active_session_refs: activeSessions.map((item) => item.sessionRef ?? item.sessionNo),
      detected_at: new Date().toISOString()
    };

    if (existing.rows[0]) {
      await this.db.query(
        `
        update alarm_event
        set session_id = coalesce($3::uuid, session_id),
            severity = $4,
            status = case when status = 'resolved' then 'open' else status end,
            trigger_reason_json = coalesce(trigger_reason_json, '{}'::jsonb) || $5::jsonb,
            auto_create_work_order = $6,
            updated_at = now()
        where id = $1::uuid and tenant_id = $2
        `,
        [
          existing.rows[0].id,
          TENANT_ID,
          sessionId,
          severity,
          JSON.stringify(triggerReason),
          activeSessions.length > 0
        ],
        client
      );
      return { id: existing.rows[0].id, created: false };
    }

    const inserted = await this.db.query<{ id: string }>(
      `
      insert into alarm_event (
        id, tenant_id, alarm_code, source_type, source_id, device_id, session_id,
        severity, status, trigger_reason_json, auto_create_work_order
      )
      values (
        $1::uuid, $2, 'DEVICE_OFFLINE', 'device', $3::uuid, $3::uuid, $4::uuid,
        $5, 'open', $6::jsonb, $7
      )
      returning id
      `,
      [
        randomUUID(),
        TENANT_ID,
        device.id,
        sessionId,
        severity,
        JSON.stringify(triggerReason),
        activeSessions.length > 0
      ],
      client
    );

    return { id: inserted.rows[0].id, created: true };
  }

  private async resolveOfflineAlarm(
    deviceId: string,
    resolution: { eventType: string; msgId: string; serverRxTs: string | null },
    client: PoolClient
  ) {
    const result = await this.db.query<{ id: string }>(
      `
      update alarm_event
      set status = 'resolved',
          trigger_reason_json = coalesce(trigger_reason_json, '{}'::jsonb) || $3::jsonb,
          updated_at = now()
      where tenant_id = $1
        and device_id = $2::uuid
        and alarm_code = 'DEVICE_OFFLINE'
        and status in ('open', 'pending', 'processing')
      returning id
      `,
      [
        TENANT_ID,
        deviceId,
        JSON.stringify({
          recovery_event_type: resolution.eventType,
          recovery_msg_id: resolution.msgId,
          recovered_at: resolution.serverRxTs ?? new Date().toISOString()
        })
      ],
      client
    );
    return result.rows.map((item) => item.id);
  }

  private async logOfflineSessionImpact(
    session: ActiveRuntimeSession,
    device: ResolvedDevice,
    alarmId: string,
    heartbeatTimeoutSeconds: number,
    client: PoolClient
  ) {
    await this.sessionStatusLogRepository.create(
      {
        tenantId: session.tenantId,
        sessionId: session.id,
        fromStatus: session.status,
        toStatus: session.status,
        actionCode: 'device_connection_lost',
        reasonCode: ErrorCodes.DEVICE_OFFLINE,
        reasonText: 'device heartbeat timeout exceeded; operator follow-up required',
        source: 'system',
        snapshot: {
          device_id: device.id,
          imei: device.imei,
          device_code: device.deviceCode,
          alarm_id: alarmId,
          heartbeat_timeout_seconds: heartbeatTimeoutSeconds
        }
      },
      client
    );
  }

  private async logConnectionRestored(
    session: ActiveRuntimeSession,
    device: ResolvedDevice,
    resolvedAlarmIds: string[],
    client: PoolClient
  ) {
    await this.sessionStatusLogRepository.create(
      {
        tenantId: session.tenantId,
        sessionId: session.id,
        fromStatus: session.status,
        toStatus: session.status,
        actionCode: 'device_connection_restored',
        reasonText: 'device heartbeat recovered and offline alarm auto-resolved',
        source: 'system',
        snapshot: {
          device_id: device.id,
          imei: device.imei,
          device_code: device.deviceCode,
          resolved_alarm_ids: resolvedAlarmIds
        }
      },
      client
    );
  }

  private async logTransportRecoveryQueued(
    session: ActiveRuntimeSession,
    device: ResolvedDevice,
    reactivatedCommands: { commandIds: string[]; commandTokens: string[] },
    recovery: { eventType: string; msgId: string; serverRxTs: string | null },
    client: PoolClient
  ) {
    await this.sessionStatusLogRepository.create(
      {
        tenantId: session.tenantId,
        sessionId: session.id,
        fromStatus: session.status,
        toStatus: session.status,
        actionCode: 'device_transport_recovered',
        reasonText: 'device connection recovered and retry-pending commands were reactivated',
        source: 'system',
        snapshot: {
          device_id: device.id,
          imei: device.imei,
          device_code: device.deviceCode,
          recovery_event_type: recovery.eventType,
          recovery_msg_id: recovery.msgId,
          recovered_at: recovery.serverRxTs ?? new Date().toISOString(),
          reactivated_command_ids: reactivatedCommands.commandIds,
          reactivated_command_tokens: reactivatedCommands.commandTokens
        }
      },
      client
    );
  }

  private async handleConnectionRecovered(
    device: ResolvedDevice,
    recovery: { eventType: string; msgId: string; serverRxTs: string | null },
    client: PoolClient
  ) {
    const resolvedOfflineAlarmIds = await this.resolveOfflineAlarm(device.id, recovery, client);
    const autoClosedOfflineWorkOrders = await this.autoCloseOfflineWorkOrders(resolvedOfflineAlarmIds, recovery, client);
    const activeSessions = await this.listActiveSessionsByDeviceImei(device.imei, client);

    if (resolvedOfflineAlarmIds.length > 0) {
      for (const activeSession of activeSessions) {
        await this.logConnectionRestored(activeSession, device, resolvedOfflineAlarmIds, client);
      }
    }

    const reactivatedRetryCommands = await this.reactivateRetryPendingCommands(device.imei, recovery, client);
    if (reactivatedRetryCommands.reactivatedCount > 0) {
      for (const activeSession of activeSessions) {
        await this.logTransportRecoveryQueued(activeSession, device, reactivatedRetryCommands, recovery, client);
      }
    }

    return {
      resolvedOfflineAlarmIds,
      autoClosedOfflineWorkOrders,
      reactivatedRetryCommands,
      impactedSessionCount: activeSessions.length
    };
  }

  async ingestRuntimeEvent(input: Record<string, unknown>) {
    const envelope = this.buildValidatedEnvelope(input);
    const event = this.adapter.toRuntimeEvent(envelope);

    return this.db.withTransaction(async (client) => {
      const device = await this.findDeviceByImei(event.imei, client);
      const messageLog = await this.insertMessageLog(event, device?.id ?? null, client);
      if (messageLog.duplicate) {
        return {
          ingested: true,
          duplicated: true,
          event_type: event.eventType,
          imei: event.imei,
          message_log_id: null
        };
      }

      if (!device) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Device IMEI is not registered', 404, {
          imei: event.imei
        });
      }

      await this.touchDevice(device, envelope, event, client);
      const connectionRecovery = await this.handleConnectionRecovered(
        device,
        {
          eventType: event.eventType,
          msgId: event.msgId,
          serverRxTs: this.toIsoTimestamp(event.serverRxTs)
        },
        client
      );

      let commandDispatch = await this.resolveCommandDispatchById(event.commandId ?? null, client);
      const deviceCommand = commandDispatch
        ? null
        : await this.resolveDeviceCommand(
            event.imei,
            event.commandId ?? null,
            event.startToken ?? null,
            event.sessionRef ?? null,
            client
          );
      const effectiveCommandToken =
        this.asString(event.commandId ?? null) ||
        deviceCommand?.commandToken ||
        this.asString(event.startToken ?? null) ||
        null;
      let session = await this.resolveSession(
        event.sessionRef ?? deviceCommand?.sessionRef ?? null,
        commandDispatch?.sessionId ?? deviceCommand?.sessionId ?? null,
        client
      );

      if (!commandDispatch) {
        commandDispatch = await this.resolveCommandDispatchByToken(
          effectiveCommandToken,
          event.startToken ?? deviceCommand?.startToken ?? null,
          event.sessionRef ?? deviceCommand?.sessionRef ?? null,
          device.id,
          deviceCommand?.commandCode ?? (this.asString(event.payload.command_code) || null),
          client
        );
        if (commandDispatch && !session) {
          session = await this.resolveSession(
            event.sessionRef ?? deviceCommand?.sessionRef ?? null,
            commandDispatch.sessionId,
            client
          );
        }
      }

      if (!commandDispatch) {
        commandDispatch = await this.resolveCommandDispatchFallback(session?.id ?? null, device.id, event.payload, client);
        if (commandDispatch && !session) {
          session = await this.resolveSession(event.sessionRef ?? null, commandDispatch.sessionId, client);
        }
      }

      const matchedDeviceCommand =
        deviceCommand ??
        (commandDispatch ? await this.resolveDeviceCommandByDispatch(commandDispatch.id, client) : null);

      if (session) {
        await this.touchRuntimeSession(session, event, envelope, commandDispatch, effectiveCommandToken, client);
      }

      const dispatchUpdate = commandDispatch ? await this.updateCommandDispatch(commandDispatch, event, matchedDeviceCommand, client) : null;
      const deviceCommandUpdate =
        matchedDeviceCommand && (event.eventType === 'DEVICE_COMMAND_ACKED' || event.eventType === 'DEVICE_COMMAND_NACKED')
          ? await this.updateDeviceCommand(matchedDeviceCommand, event, client)
          : null;
      if (session) {
        await this.completeStoppingSessionIfNeeded(session, event, commandDispatch, effectiveCommandToken, client);
      }
      const alarm = event.eventType === 'DEVICE_ALARM_RAISED' ? await this.createAlarm(device.id, session?.id ?? null, event, client) : null;

      return {
        ingested: true,
        duplicated: false,
        event_type: event.eventType,
        imei: event.imei,
        device: {
          id: device.id,
          device_code: device.deviceCode,
          device_name: device.deviceName
        },
        session: session
          ? {
              id: session.id,
              session_no: session.sessionNo,
              session_ref: session.sessionRef ?? event.sessionRef ?? null,
              status: session.status
            }
          : null,
        command_dispatch: dispatchUpdate
          ? {
              id: dispatchUpdate.id,
              dispatch_status: dispatchUpdate.dispatchStatus,
              acked_at: dispatchUpdate.ackedAt
            }
          : null,
        device_command: deviceCommandUpdate
          ? {
              id: deviceCommandUpdate.id,
              command_status: deviceCommandUpdate.commandStatus,
              acked_at: deviceCommandUpdate.ackedAt,
              failed_at: deviceCommandUpdate.failedAt
            }
          : null,
        alarm: alarm ? { id: alarm.id } : null,
        auto_closed_work_orders: connectionRecovery.autoClosedOfflineWorkOrders.closedWorkOrderIds,
        recovery: {
          resolved_offline_alarm_ids: connectionRecovery.resolvedOfflineAlarmIds,
          reactivated_retry_command_ids: connectionRecovery.reactivatedRetryCommands.commandIds,
          reactivated_retry_command_tokens: connectionRecovery.reactivatedRetryCommands.commandTokens
        }
      };
    });
  }

  private async queueCommandInClient(
    input: {
      target_device_id?: string;
      imei?: string;
      session_id?: string | null;
      session_ref?: string | null;
      order_id?: string | null;
      command_code?: string;
      request_payload?: Record<string, unknown>;
      start_token?: string | null;
      request_msg_id?: string | null;
      request_seq_no?: number | null;
      create_dispatch?: boolean;
      source?: string | null;
    },
    client: PoolClient
  ) {
    const normalizedCommandCode = this.asString(input.command_code).toUpperCase();
    if (!normalizedCommandCode) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'command_code is required');
    }

    const device = this.asString(input.target_device_id)
      ? await this.findDeviceById(this.asString(input.target_device_id), client)
      : await this.findDeviceByImei(this.asString(input.imei), client);

    if (!device) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Target device was not found', 404, {
        target_device_id: input.target_device_id ?? null,
        imei: input.imei ?? null
      });
    }

    const commandToken = randomUUID();
    const startToken = this.asString(input.start_token) || null;
    const sessionId = this.asString(input.session_id) || null;
    const sessionRef = this.asString(input.session_ref) || null;
    const orderId = this.asString(input.order_id) || null;
    const requestPayload = {
      ...this.asObject(input.request_payload),
      source: this.asString(input.source) || 'backend_command_queue',
      command_code: normalizedCommandCode,
      command_id: commandToken,
      device_command_token: commandToken,
      start_token: startToken,
      session_ref: sessionRef,
      imei: this.asString(input.imei) || device.imei,
      target_device_id: device.id
    };

    const insertedCommand = await this.db.query<QueuedDeviceCommand>(
      `
      insert into device_command (
        id,
        command_id,
        tenant_id,
        session_id,
        order_id,
        target_device_id,
        imei,
        command_code,
        command_status,
        start_token,
        session_ref,
        request_msg_id,
        request_seq_no,
        request_payload_json
      )
      values (
        $1::uuid,
        $2::uuid,
        $3,
        $4::uuid,
        $5::uuid,
        $6::uuid,
        $7,
        $8,
        'created',
        $9,
        $10,
        $11,
        $12,
        $13::jsonb
      )
      returning
        id,
        command_id::text as "commandToken",
        command_code as "commandCode",
        command_status as "commandStatus",
        target_device_id as "targetDeviceId",
        imei,
        session_id as "sessionId",
        session_ref as "sessionRef",
        start_token as "startToken",
        sent_at as "sentAt",
        acked_at as "ackedAt",
        request_payload_json as "requestPayload"
      `,
      [
        randomUUID(),
        commandToken,
        TENANT_ID,
        this.looksLikeUuid(sessionId) ? sessionId : null,
        this.looksLikeUuid(orderId) ? orderId : null,
        device.id,
        this.asString(input.imei) || device.imei,
        normalizedCommandCode,
        startToken,
        sessionRef,
        this.asString(input.request_msg_id) || null,
        this.asNumber(input.request_seq_no),
        JSON.stringify(requestPayload)
      ],
      client
    );

    let dispatchRow: { id: string; dispatchStatus: string } | null = null;
    if (input.create_dispatch && this.looksLikeUuid(sessionId)) {
      const dispatch = await this.db.query<{ id: string; dispatchStatus: string }>(
        `
        insert into command_dispatch (
          id,
          tenant_id,
          session_id,
          target_device_id,
          command_code,
          dispatch_status,
          request_payload_json
        )
        values (
          $1::uuid,
          $2,
          $3::uuid,
          $4::uuid,
          $5,
          'created',
          $6::jsonb
        )
        returning id, dispatch_status as "dispatchStatus"
        `,
        [randomUUID(), TENANT_ID, sessionId, device.id, normalizedCommandCode, JSON.stringify(requestPayload)],
        client
      );
      dispatchRow = dispatch.rows[0] ?? null;
    }

    return {
      result: 'success',
      message: `Queued ${normalizedCommandCode} for ${device.deviceName || device.deviceCode}`,
      command: {
        id: insertedCommand.rows[0].id,
        command_token: insertedCommand.rows[0].commandToken,
        command_code: insertedCommand.rows[0].commandCode,
        command_status: insertedCommand.rows[0].commandStatus,
        imei: insertedCommand.rows[0].imei,
        session_id: insertedCommand.rows[0].sessionId,
        session_ref: insertedCommand.rows[0].sessionRef,
        start_token: insertedCommand.rows[0].startToken
      },
      dispatch: dispatchRow
        ? {
            id: dispatchRow.id,
            dispatch_status: dispatchRow.dispatchStatus
          }
        : null
    };
  }

  async queueCommand(
    input: {
      target_device_id?: string;
      imei?: string;
      session_id?: string | null;
    session_ref?: string | null;
    order_id?: string | null;
    command_code?: string;
    request_payload?: Record<string, unknown>;
    start_token?: string | null;
    request_msg_id?: string | null;
      request_seq_no?: number | null;
      create_dispatch?: boolean;
      source?: string | null;
    },
    client?: PoolClient
  ) {
    if (client) {
      return this.queueCommandInClient(input, client);
    }

    return this.db.withTransaction((tx) => this.queueCommandInClient(input, tx));
  }

  async pullPendingCommands(params?: {
    imei?: string;
    session_ref?: string;
    limit?: number;
    mark_sent?: boolean;
    include_sent?: boolean;
  }) {
    const filters: string[] = ['dc.tenant_id = $1'];
    const values: unknown[] = [TENANT_ID];
    const includeSent = params?.include_sent === true;
    const markSent = params?.mark_sent !== false;

    if (this.asString(params?.imei)) {
      values.push(this.asString(params?.imei));
      filters.push(`dc.imei = $${values.length}`);
    }

    if (this.asString(params?.session_ref)) {
      values.push(this.asString(params?.session_ref));
      filters.push(`dc.session_ref = $${values.length}`);
    }

    const activeStatuses = includeSent ? ['created', 'sent', 'retry_pending'] : ['created', 'retry_pending'];
    values.push(activeStatuses);
    const statusParam = `$${values.length}`;

    const limit = Math.min(Math.max(Number(params?.limit ?? 20), 1), 100);
    values.push(limit);

    return this.db.withTransaction(async (client) => {
      const result = await this.db.query<QueuedDeviceCommand & { deviceName: string | null }>(
        `
        select
          dc.id,
          dc.command_id::text as "commandToken",
          dc.command_code as "commandCode",
          dc.command_status as "commandStatus",
          dc.target_device_id as "targetDeviceId",
          dc.imei,
          dc.session_id as "sessionId",
          dc.session_ref as "sessionRef",
          dc.start_token as "startToken",
          dc.sent_at as "sentAt",
          dc.acked_at as "ackedAt",
          dc.request_payload_json as "requestPayload",
          d.device_name as "deviceName"
        from device_command dc
        left join device d on d.id = dc.target_device_id
        where ${filters.join(' and ')}
          and dc.command_status = any(${statusParam}::text[])
          and (
            dc.command_status <> 'retry_pending'
            or coalesce(nullif(dc.response_payload_json #>> '{transport,next_retry_at}', '')::timestamptz, '-infinity'::timestamptz) <= now()
          )
        order by dc.created_at asc
        limit $${values.length}
        `,
        values,
        client
      );

      if (markSent && result.rows.length > 0) {
        const commandIds = result.rows
          .filter((row) => row.commandStatus === 'created' || row.commandStatus === 'retry_pending')
          .map((row) => row.id);
        const commandTokens = result.rows.map((row) => row.commandToken);

        if (commandIds.length > 0) {
          await this.db.query(
            `
            update device_command
            set command_status = case when command_status in ('created', 'retry_pending') then 'sent' else command_status end,
                sent_at = now(),
                updated_at = now()
            where id = any($1::uuid[])
            `,
            [commandIds],
            client
          );
        }

        if (commandTokens.length > 0) {
          await this.db.query(
            `
            update command_dispatch
            set dispatch_status = case when dispatch_status in ('created', 'retry_pending') then 'sent' else dispatch_status end,
                sent_at = now()
            where tenant_id = $1
              and coalesce(
                request_payload_json->>'device_command_token',
                request_payload_json->>'command_token',
                request_payload_json->>'device_command_id',
                request_payload_json->>'command_id'
              ) = any($2::text[])
            `,
            [TENANT_ID, commandTokens],
            client
          );
        }
      }

      return {
        items: result.rows.map((row) => ({
          id: row.id,
          command_token: row.commandToken,
          command_code: row.commandCode,
          command_status:
            markSent && (row.commandStatus === 'created' || row.commandStatus === 'retry_pending')
              ? 'sent'
              : row.commandStatus,
          imei: row.imei,
          session_id: row.sessionId,
          session_ref: row.sessionRef,
          start_token: row.startToken,
          sent_at: markSent && (row.commandStatus === 'created' || row.commandStatus === 'retry_pending')
            ? new Date().toISOString()
            : row.sentAt,
          acked_at: row.ackedAt,
          device_name: row.deviceName,
          request_payload: row.requestPayload
        })),
        total: result.rows.length,
        queue_mode: 'backend_command_queue',
        ack_endpoint: '/api/v1/ops/device-gateway/runtime-events'
      };
    });
  }

  async listRecentEvents(params?: { imei?: string; session_ref?: string; limit?: number }) {
    const filters: string[] = ['dml.tenant_id = $1'];
    const values: unknown[] = [TENANT_ID];

    if (this.asString(params?.imei)) {
      values.push(this.asString(params?.imei));
      filters.push(`dml.imei = $${values.length}`);
    }

    if (this.asString(params?.session_ref)) {
      values.push(this.asString(params?.session_ref));
      filters.push(`dml.session_ref = $${values.length}`);
    }

    const limit = Math.min(Math.max(Number(params?.limit ?? 20), 1), 100);
    values.push(limit);

    const result = await this.db.query<{
      id: string;
      imei: string;
      msgType: string;
      eventType: string | null;
      sessionRef: string | null;
      commandId: string | null;
      commandToken: string | null;
      commandCode: string | null;
      startToken: string | null;
      serverRxTs: string;
      seqNo: number | null;
      deviceName: string | null;
      payload: Record<string, unknown>;
    }>(
      `
      select
        dml.id,
        dml.imei,
        dml.msg_type as "msgType",
        dml.payload_json->>'event_type' as "eventType",
        dml.session_ref as "sessionRef",
        dml.command_id::text as "commandId",
        coalesce(
          dml.payload_json #>> '{payload,command_id}',
          dml.payload_json #>> '{payload,commandId}'
        ) as "commandToken",
        coalesce(
          dml.payload_json #>> '{payload,command_code}',
          dml.payload_json #>> '{payload,commandCode}'
        ) as "commandCode",
        coalesce(
          dml.payload_json #>> '{payload,start_token}',
          dml.payload_json #>> '{payload,startToken}'
        ) as "startToken",
        dml.server_rx_ts as "serverRxTs",
        dml.seq_no as "seqNo",
        d.device_name as "deviceName",
        dml.payload_json as payload
      from device_message_log dml
      left join device d on d.id = dml.device_id
      where ${filters.join(' and ')}
      order by dml.created_at desc
      limit $${values.length}
      `,
      values
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        imei: row.imei,
        msg_type: row.msgType,
        event_type: row.eventType,
        session_ref: row.sessionRef,
        command_id: row.commandId,
        command_token: row.commandToken,
        command_code: row.commandCode,
        start_token: row.startToken,
        seq_no: row.seqNo,
        server_rx_ts: row.serverRxTs,
        device_name: row.deviceName,
        payload: row.payload
      })),
      total: result.rows.length
    };
  }

  async getQueueHealth() {
    const timeoutSeconds = this.getSentTimeoutSeconds();
    const summary = await this.db.query<{
      created_count: number;
      sent_count: number;
      retry_pending_count: number;
      ready_retry_pending_count: number;
      blocked_retry_pending_count: number;
      acked_count: number;
      failed_count: number;
      dead_letter_count: number;
      timeout_overdue_count: number;
      oldest_unacked_at: string | null;
      next_retry_due_at: string | null;
    }>(
      `
      select
        count(*) filter (where command_status = 'created')::int as created_count,
        count(*) filter (where command_status = 'sent')::int as sent_count,
        count(*) filter (where command_status = 'retry_pending')::int as retry_pending_count,
        count(*) filter (
          where command_status = 'retry_pending'
            and coalesce(nullif(response_payload_json #>> '{transport,next_retry_at}', '')::timestamptz, '-infinity'::timestamptz) <= now()
        )::int as ready_retry_pending_count,
        count(*) filter (
          where command_status = 'retry_pending'
            and coalesce(nullif(response_payload_json #>> '{transport,next_retry_at}', '')::timestamptz, '-infinity'::timestamptz) > now()
        )::int as blocked_retry_pending_count,
        count(*) filter (where command_status = 'acked')::int as acked_count,
        count(*) filter (where command_status = 'failed')::int as failed_count,
        count(*) filter (where command_status = 'dead_letter')::int as dead_letter_count,
        count(*) filter (
          where command_status = 'sent'
            and sent_at is not null
            and sent_at < now() - ($2::int * interval '1 second')
        )::int as timeout_overdue_count,
        min(created_at) filter (
          where command_status in ('created', 'sent', 'retry_pending', 'failed', 'dead_letter')
        )::text as oldest_unacked_at
        ,
        min(nullif(response_payload_json #>> '{transport,next_retry_at}', '')::timestamptz) filter (
          where command_status = 'retry_pending'
            and coalesce(nullif(response_payload_json #>> '{transport,next_retry_at}', '')::timestamptz, '-infinity'::timestamptz) > now()
        )::text as next_retry_due_at
      from device_command
      where tenant_id = $1
      `,
      [TENANT_ID, timeoutSeconds]
    );

    const row = summary.rows[0];
    return {
      queue_mode: 'backend_command_queue',
      policy: this.getTransportPolicy(),
      counts: {
        created: row.created_count,
        sent: row.sent_count,
        retry_pending: row.retry_pending_count,
        ready_retry_pending: row.ready_retry_pending_count,
        blocked_retry_pending: row.blocked_retry_pending_count,
        acked: row.acked_count,
        failed: row.failed_count,
        dead_letter: row.dead_letter_count
      },
      timeout_overdue_count: row.timeout_overdue_count,
      oldest_unacked_at: row.oldest_unacked_at,
      next_retry_due_at: row.next_retry_due_at
    };
  }

  async getConnectionHealth() {
    const heartbeatTimeoutSeconds = this.getHeartbeatTimeoutSeconds();
    const disconnectGraceSeconds = this.getDisconnectGraceSeconds();
    const summary = await this.db.query<{
      total_devices: number;
      connected_devices: number;
      disconnected_devices: number;
      online_devices: number;
      heartbeat_stale_devices: number;
      disconnect_grace_pending_devices: number;
      never_reported_devices: number;
      impacted_active_sessions: number;
      latest_heartbeat_at: string | null;
      next_offline_due_at: string | null;
      next_disconnect_due_at: string | null;
    }>(
      `
      with device_scope as (
        select
          d.id,
          d.imei,
          d.online_state,
          d.connection_state,
          d.last_heartbeat_at,
          d.created_at
        from device d
        where d.tenant_id = $1
          and d.imei is not null
      ),
      session_scope as (
        select
          rs.device_key,
          count(*)::int as active_session_count
        from runtime_session rs
        where rs.tenant_id = $1
          and rs.status in ('pending_start', 'running', 'billing', 'stopping')
        group by rs.device_key
      )
      select
        count(*)::int as total_devices,
        count(*) filter (where connection_state = 'connected')::int as connected_devices,
        count(*) filter (where connection_state <> 'connected')::int as disconnected_devices,
        count(*) filter (where online_state = 'online')::int as online_devices,
        count(*) filter (
          where last_heartbeat_at is not null
            and last_heartbeat_at < now() - ($2::int * interval '1 second')
        )::int as heartbeat_stale_devices,
        count(*) filter (
          where connection_state = 'disconnected'
            and last_heartbeat_at is not null
            and last_heartbeat_at >= now() - ($3::int * interval '1 second')
        )::int as disconnect_grace_pending_devices,
        count(*) filter (where last_heartbeat_at is null)::int as never_reported_devices,
        coalesce(sum(ss.active_session_count) filter (
          where ds.last_heartbeat_at is null
             or ds.last_heartbeat_at < now() - ($2::int * interval '1 second')
             or ds.connection_state <> 'connected'
        ), 0)::int as impacted_active_sessions,
        max(last_heartbeat_at)::text as latest_heartbeat_at,
        min(last_heartbeat_at + ($2::int * interval '1 second')) filter (
          where connection_state = 'connected'
            and last_heartbeat_at is not null
        )::text as next_offline_due_at,
        min(last_heartbeat_at + ($3::int * interval '1 second')) filter (
          where connection_state = 'disconnected'
            and last_heartbeat_at is not null
        )::text as next_disconnect_due_at
      from device_scope ds
      left join session_scope ss on ss.device_key = ds.imei
      `,
      [TENANT_ID, heartbeatTimeoutSeconds, disconnectGraceSeconds]
    );

    const riskyDevices = await this.db.query<DeviceConnectionHealthRow>(
      `
      select
        d.id,
        d.imei,
        d.device_code as "deviceCode",
        d.device_name as "deviceName",
        d.online_state as "onlineState",
        d.connection_state as "connectionState",
        d.runtime_state as "runtimeState",
        d.last_heartbeat_at::text as "lastHeartbeatAt",
        d.last_device_ts::text as "lastDeviceTs",
        count(rs.id)::int as "activeSessionCount",
        coalesce(array_remove(array_agg(distinct rs.session_ref), null), '{}'::varchar[]) as "affectedSessionRefs",
        case
          when d.last_heartbeat_at is null then null
          else greatest(0, floor(extract(epoch from (now() - d.last_heartbeat_at))))::int
        end as "secondsSinceHeartbeat"
      from device d
      left join runtime_session rs
        on rs.tenant_id = d.tenant_id
       and rs.device_key = d.imei
       and rs.status in ('pending_start', 'running', 'billing', 'stopping')
      where d.tenant_id = $1
        and d.imei is not null
        and (
          d.connection_state <> 'connected'
          or d.last_heartbeat_at is null
          or d.last_heartbeat_at < now() - ($2::int * interval '1 second')
        )
      group by d.id
      order by count(rs.id) desc, "secondsSinceHeartbeat" desc nulls last, d.updated_at desc
      limit 8
      `,
      [TENANT_ID, heartbeatTimeoutSeconds]
    );

    const row = summary.rows[0];
    return {
      connection_mode: 'heartbeat_plus_transport_session',
      policy: {
        heartbeat_timeout_seconds: heartbeatTimeoutSeconds,
        disconnect_grace_seconds: disconnectGraceSeconds,
        stale_online_state: 'offline',
        stale_connection_state: 'disconnected'
      },
      counts: {
        total_devices: row.total_devices,
        connected_devices: row.connected_devices,
        disconnected_devices: row.disconnected_devices,
        online_devices: row.online_devices,
        heartbeat_stale_devices: row.heartbeat_stale_devices,
        disconnect_grace_pending_devices: row.disconnect_grace_pending_devices,
        never_reported_devices: row.never_reported_devices,
        impacted_active_sessions: row.impacted_active_sessions
      },
      latest_heartbeat_at: row.latest_heartbeat_at,
      next_offline_due_at: row.next_offline_due_at,
      next_disconnect_due_at: row.next_disconnect_due_at,
      transport_modes: ['tcp_socket', 'http_bridge'],
      risky_devices: riskyDevices.rows.map((item) => ({
        id: item.id,
        imei: item.imei,
        device_code: item.deviceCode,
        device_name: item.deviceName,
        online_state: item.onlineState,
        connection_state: item.connectionState,
        runtime_state: item.runtimeState,
        last_heartbeat_at: item.lastHeartbeatAt,
        last_device_ts: item.lastDeviceTs,
        seconds_since_heartbeat: item.secondsSinceHeartbeat,
        active_session_count: item.activeSessionCount,
        affected_session_refs: item.affectedSessionRefs
      }))
    };
  }

  async getRecoveryRecommendations() {
    const [queueHealth, connectionHealth, deadLetters] = await Promise.all([
      this.getQueueHealth(),
      this.getConnectionHealth(),
      this.listDeadLetters({ limit: 5 })
    ]);

    const recommendations: GatewayRecoveryRecommendation[] = [];

    if (
      connectionHealth.counts.impacted_active_sessions > 0 &&
      connectionHealth.counts.connected_devices === 0
    ) {
      recommendations.push({
        id: 'transport_bridge_down',
        severity: 'critical',
        title: '当前没有在线连接的设备桥接通道',
        reason: `仍有 ${connectionHealth.counts.impacted_active_sessions} 个活跃会话受连接异常影响，但当前已连接设备为 0。`,
        suggestedAction: '优先检查串口或外部网关 bridge，再执行连接清扫并回看处置台。',
        preferredEndpoint: '/api/v1/ops/device-gateway/connection-health',
        stats: {
          connected_devices: connectionHealth.counts.connected_devices,
          impacted_active_sessions: connectionHealth.counts.impacted_active_sessions
        }
      });
    }

    if (connectionHealth.counts.disconnect_grace_pending_devices > 0) {
      recommendations.push({
        id: 'disconnect_grace_pending',
        severity: 'warning',
        title: '有设备处于断连观察期',
        reason: `当前有 ${connectionHealth.counts.disconnect_grace_pending_devices} 台设备刚断开连接，还在观察窗口内。`,
        suggestedAction: '优先等待短暂恢复或复测链路，不要立刻重复下发新命令。',
        preferredEndpoint: '/api/v1/ops/device-gateway/connection-health',
        stats: {
          disconnect_grace_pending_devices: connectionHealth.counts.disconnect_grace_pending_devices,
          next_disconnect_due_at: connectionHealth.next_disconnect_due_at
        }
      });
    }

    if (queueHealth.timeout_overdue_count > 0) {
      recommendations.push({
        id: 'ack_timeout_overdue',
        severity: 'critical',
        title: '存在等待 ACK 超时的命令',
        reason: `当前有 ${queueHealth.timeout_overdue_count} 条已发送命令超出 ACK 等待窗口。`,
        suggestedAction: '优先执行 retry sweep 或检查目标设备连接状态，再决定是否人工回收。',
        preferredEndpoint: '/api/v1/ops/device-gateway/sweep-retries',
        stats: {
          timeout_overdue_count: queueHealth.timeout_overdue_count,
          oldest_unacked_at: queueHealth.oldest_unacked_at
        }
      });
    }

    if (queueHealth.counts.ready_retry_pending > 0) {
      recommendations.push({
        id: 'ready_retry_pending',
        severity: 'warning',
        title: '存在可立即重试的命令',
        reason: `当前有 ${queueHealth.counts.ready_retry_pending} 条命令已到重试时间窗口。`,
        suggestedAction: '检查连接健康后执行 retry sweep，避免积压在 retry_pending。',
        preferredEndpoint: '/api/v1/ops/device-gateway/sweep-retries',
        stats: {
          ready_retry_pending: queueHealth.counts.ready_retry_pending,
          retry_pending: queueHealth.counts.retry_pending
        }
      });
    }

    if (queueHealth.counts.dead_letter > 0 || deadLetters.items.length > 0) {
      recommendations.push({
        id: 'dead_letter_present',
        severity: 'critical',
        title: '存在死信命令需要人工确认',
        reason: `当前累计 ${queueHealth.counts.dead_letter} 条死信命令，最近死信样本 ${deadLetters.items.length} 条。`,
        suggestedAction: '先查看死信原因，再决定人工回收、重新下发，或调整设备侧协议字段。',
        preferredEndpoint: '/api/v1/ops/device-gateway/dead-letters',
        stats: {
          dead_letter_count: queueHealth.counts.dead_letter,
          recent_dead_letters: deadLetters.items.length
        }
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        id: 'transport_stable',
        severity: 'info',
        title: '当前 transport 主链稳定',
        reason: '未发现超时重试、死信堆积或活跃会话受断连影响的异常信号。',
        suggestedAction: '可继续验证 solver 结果和设备脚本，不必额外介入 transport 恢复。',
        preferredEndpoint: null,
        stats: {
          connected_devices: connectionHealth.counts.connected_devices,
          dead_letter_count: queueHealth.counts.dead_letter,
          timeout_overdue_count: queueHealth.timeout_overdue_count
        }
      });
    }

    return {
      generated_at: new Date().toISOString(),
      queue_mode: queueHealth.queue_mode,
      connection_mode: connectionHealth.connection_mode,
      recommendation_count: recommendations.length,
      recommendations
    };
  }

  async sweepConnections() {
    const heartbeatTimeoutSeconds = this.getHeartbeatTimeoutSeconds();
    const disconnectGraceSeconds = this.getDisconnectGraceSeconds();

    return this.db.withTransaction(async (client) => {
      const workOrderPolicy = await this.getOfflineWorkOrderPolicy(client);
      const devices = await this.db.query<{ id: string; imei: string; deviceName: string | null; deviceCode: string }>(
        `
        update device
        set online_state = 'offline',
            connection_state = 'disconnected',
            updated_at = now()
        where tenant_id = $1
          and imei is not null
          and (
            last_heartbeat_at is null
            or last_heartbeat_at < now() - ($2::int * interval '1 second')
            or (
              connection_state = 'disconnected'
              and last_heartbeat_at is not null
              and last_heartbeat_at < now() - ($3::int * interval '1 second')
            )
          )
          and (
            online_state = 'online'
            or connection_state = 'connected'
            or (connection_state = 'disconnected' and coalesce(online_state, 'unknown') <> 'offline')
          )
        returning id, imei, device_name as "deviceName", device_code as "deviceCode"
        `,
        [TENANT_ID, heartbeatTimeoutSeconds, disconnectGraceSeconds],
        client
      );

      await this.db.query(
        `
        update device_connection_session
        set disconnected_at = coalesce(disconnected_at, now()),
            connection_status = 'disconnected',
            updated_at = now()
        where tenant_id = $1
          and disconnected_at is null
          and imei in (
            select imei
            from device
            where tenant_id = $1
              and imei is not null
              and (
                last_heartbeat_at is null
                or last_heartbeat_at < now() - ($2::int * interval '1 second')
                or (
                  connection_state = 'disconnected'
                  and last_heartbeat_at is not null
                  and last_heartbeat_at < now() - ($3::int * interval '1 second')
                )
              )
          )
        `,
        [TENANT_ID, heartbeatTimeoutSeconds, disconnectGraceSeconds],
        client
      );

      let createdAlarmCount = 0;
      let refreshedAlarmCount = 0;
      let impactedSessionCount = 0;
      let createdWorkOrderCount = 0;
      let reusedWorkOrderCount = 0;
      let autoAssignedWorkOrderCount = 0;

      for (const item of devices.rows) {
        const device: ResolvedDevice = {
          id: item.id,
          imei: item.imei,
          deviceCode: item.deviceCode,
          deviceName: item.deviceName,
          onlineState: 'offline',
          runtimeState: null
        };
        const activeSessions = await this.listActiveSessionsByDeviceImei(item.imei, client);
        const alarm = await this.createOrRefreshOfflineAlarm(device, activeSessions, heartbeatTimeoutSeconds, client);
        if (alarm.created) {
          createdAlarmCount += 1;
        } else {
          refreshedAlarmCount += 1;
        }
        impactedSessionCount += activeSessions.length;

        const workOrder = await this.createOrRefreshOfflineWorkOrder(
          alarm.id,
          device,
          activeSessions,
          heartbeatTimeoutSeconds,
          workOrderPolicy,
          client
        );
        if (workOrder) {
          await this.markAlarmProcessingForWorkOrder(alarm.id, workOrder, client);
          if (workOrder.created) {
            createdWorkOrderCount += 1;
          } else {
            reusedWorkOrderCount += 1;
          }
          if (workOrder.autoAssigned) {
            autoAssignedWorkOrderCount += 1;
          }
        }

        for (const session of activeSessions) {
          await this.logOfflineSessionImpact(session, device, alarm.id, heartbeatTimeoutSeconds, client);
        }
      }

      return {
        connection_mode: 'heartbeat_plus_transport_session',
        heartbeat_timeout_seconds: heartbeatTimeoutSeconds,
        disconnect_grace_seconds: disconnectGraceSeconds,
        swept_device_count: devices.rows.length,
        swept_imeis: devices.rows.map((item) => item.imei),
        created_alarm_count: createdAlarmCount,
        refreshed_alarm_count: refreshedAlarmCount,
        impacted_session_count: impactedSessionCount,
        created_work_order_count: createdWorkOrderCount,
        reused_work_order_count: reusedWorkOrderCount,
        auto_assigned_work_order_count: autoAssignedWorkOrderCount
      };
    });
  }

  async listDeadLetters(params?: { imei?: string; session_ref?: string; limit?: number }) {
    const filters: string[] = [`dc.tenant_id = $1`, `dc.command_status in ('failed', 'dead_letter')`];
    const values: unknown[] = [TENANT_ID];

    if (this.asString(params?.imei)) {
      values.push(this.asString(params?.imei));
      filters.push(`dc.imei = $${values.length}`);
    }

    if (this.asString(params?.session_ref)) {
      values.push(this.asString(params?.session_ref));
      filters.push(`dc.session_ref = $${values.length}`);
    }

    const limit = Math.min(Math.max(Number(params?.limit ?? 20), 1), 100);
    values.push(limit);

    const result = await this.db.query<DeviceCommandQueueRow & { deviceName: string | null }>(
      `
      select
        dc.id,
        dc.command_id::text as "commandToken",
        dc.command_code as "commandCode",
        dc.command_status as "commandStatus",
        dc.target_device_id as "targetDeviceId",
        dc.imei,
        dc.session_id as "sessionId",
        dc.session_ref as "sessionRef",
        dc.start_token as "startToken",
        dc.sent_at as "sentAt",
        dc.acked_at as "ackedAt",
        dc.failed_at as "failedAt",
        dc.timeout_at as "timeoutAt",
        dc.request_payload_json as "requestPayload",
        dc.response_payload_json as "responsePayload",
        d.device_name as "deviceName"
      from device_command dc
      left join device d on d.id = dc.target_device_id
      where ${filters.join(' and ')}
      order by coalesce(dc.failed_at, dc.timeout_at, dc.updated_at) desc
      limit $${values.length}
      `,
      values
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        command_token: row.commandToken,
        command_code: row.commandCode,
        command_status: row.commandStatus,
        imei: row.imei,
        session_id: row.sessionId,
        session_ref: row.sessionRef,
        start_token: row.startToken,
        sent_at: row.sentAt,
        acked_at: row.ackedAt,
        failed_at: row.failedAt,
        timeout_at: row.timeoutAt,
        retry_count: this.getRetryCount(row.responsePayload),
        device_name: row.deviceName,
        request_payload: row.requestPayload,
        response_payload: row.responsePayload
      })),
      total: result.rows.length,
      queue_mode: 'backend_command_queue'
    };
  }

  private async updateDispatchStatusByCommandToken(
    commandToken: string,
    dispatchStatus: string,
    transportPatch: Record<string, unknown>,
    client: PoolClient
  ) {
    await this.db.query(
      `
      update command_dispatch
      set dispatch_status = $2::varchar,
          sent_at = case when $2::varchar = 'retry_pending' then null else sent_at end,
          acked_at = case when $2::varchar = 'retry_pending' then null else acked_at end,
          response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $3::jsonb
      where tenant_id = $1
        and coalesce(
          request_payload_json->>'device_command_token',
          request_payload_json->>'command_token',
          request_payload_json->>'device_command_id',
          request_payload_json->>'command_id'
        ) = $4
      `,
      [TENANT_ID, dispatchStatus, JSON.stringify({ transport: transportPatch }), commandToken],
      client
    );
  }

  async sweepRetries() {
    const policy = this.getTransportPolicy();

    return this.db.withTransaction(async (client) => {
      const candidates = await this.db.query<DeviceCommandQueueRow>(
        `
        select
          dc.id,
          dc.command_id::text as "commandToken",
          dc.command_code as "commandCode",
          dc.command_status as "commandStatus",
          dc.target_device_id as "targetDeviceId",
          dc.imei,
          dc.session_id as "sessionId",
          dc.session_ref as "sessionRef",
          dc.start_token as "startToken",
          dc.sent_at as "sentAt",
          dc.acked_at as "ackedAt",
          dc.failed_at as "failedAt",
          dc.timeout_at as "timeoutAt",
          dc.request_payload_json as "requestPayload",
          dc.response_payload_json as "responsePayload"
        from device_command dc
        where dc.tenant_id = $1
          and dc.command_status = 'sent'
          and dc.sent_at is not null
          and dc.sent_at < now() - ($2::int * interval '1 second')
        order by dc.sent_at asc
        limit 100
        `,
        [TENANT_ID, policy.sent_timeout_seconds],
        client
      );

      let retryQueued = 0;
      let deadLettered = 0;

      for (const row of candidates.rows) {
        const retryCount = this.getRetryCount(row.responsePayload);
        const nextRetryCount = retryCount + 1;
        const canRetry = nextRetryCount <= policy.retry_limit;
        const nextRetryAt = canRetry ? this.computeNextRetryAt(nextRetryCount) : null;
        const nextStatus = canRetry ? 'retry_pending' : 'dead_letter';
        const transportPatch = {
          retry_count: nextRetryCount,
          retry_delay_seconds: canRetry ? this.computeRetryDelaySeconds(nextRetryCount) : null,
          next_retry_at: nextRetryAt,
          last_transition: canRetry ? 'timeout_requeue' : 'dead_letter_timeout',
          last_timeout_at: new Date().toISOString(),
          dead_letter_reason: canRetry ? null : 'ack_timeout_exceeded'
        };

        await this.db.query(
          `
          update device_command
          set command_status = $2::varchar,
              sent_at = case when $2::varchar = 'retry_pending' then null else sent_at end,
              timeout_at = now(),
              failed_at = case when $2::varchar = 'dead_letter' then now() else failed_at end,
              response_payload_json = $3::jsonb,
              updated_at = now()
          where id = $1::uuid
          `,
          [row.id, nextStatus, JSON.stringify(this.mergeTransportPayload(row.responsePayload, transportPatch))],
          client
        );

        await this.updateDispatchStatusByCommandToken(row.commandToken, nextStatus, transportPatch, client);

        if (canRetry) {
          retryQueued += 1;
        } else {
          deadLettered += 1;
        }
      }

      return {
        queue_mode: 'backend_command_queue',
        policy,
        scanned: candidates.rows.length,
        retry_queued: retryQueued,
        dead_lettered: deadLettered
      };
    });
  }

  async requeueCommand(commandId: string) {
    if (!this.looksLikeUuid(commandId)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'commandId must be a uuid');
    }

    return this.db.withTransaction(async (client) => {
      const result = await this.db.query<DeviceCommandQueueRow>(
        `
        select
          dc.id,
          dc.command_id::text as "commandToken",
          dc.command_code as "commandCode",
          dc.command_status as "commandStatus",
          dc.target_device_id as "targetDeviceId",
          dc.imei,
          dc.session_id as "sessionId",
          dc.session_ref as "sessionRef",
          dc.start_token as "startToken",
          dc.sent_at as "sentAt",
          dc.acked_at as "ackedAt",
          dc.failed_at as "failedAt",
          dc.timeout_at as "timeoutAt",
          dc.request_payload_json as "requestPayload",
          dc.response_payload_json as "responsePayload"
        from device_command dc
        where dc.tenant_id = $1 and dc.id = $2::uuid
        limit 1
        `,
        [TENANT_ID, commandId],
        client
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Device command not found', 404, { commandId });
      }

      if (row.commandStatus === 'acked') {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Acked command cannot be requeued', 400, {
          commandId,
          commandStatus: row.commandStatus
        });
      }

      const transportPatch = {
        retry_count: this.getRetryCount(row.responsePayload),
        retry_delay_seconds: 0,
        next_retry_at: new Date().toISOString(),
        last_transition: 'manual_requeue',
        manual_requeue_at: new Date().toISOString(),
        dead_letter_reason: null
      };

      await this.db.query(
        `
        update device_command
        set command_status = 'retry_pending',
            sent_at = null,
            acked_at = null,
            failed_at = null,
            timeout_at = null,
            response_payload_json = $2::jsonb,
            updated_at = now()
        where id = $1::uuid
        `,
        [row.id, JSON.stringify(this.mergeTransportPayload(row.responsePayload, transportPatch))],
        client
      );

      await this.updateDispatchStatusByCommandToken(row.commandToken, 'retry_pending', transportPatch, client);

      return {
        result: 'success',
        command_id: row.id,
        command_token: row.commandToken,
        command_status: 'retry_pending'
      };
    });
  }
}
