import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { DeviceEnvelope } from '../protocol-adapter/device-envelope';
import { DeviceRuntimeEvent } from '../protocol-adapter/device-runtime-event';
import { TcpJsonV1Adapter } from '../protocol-adapter/tcp-json-v1.adapter';
import { OrderRepository } from '../order/order.repository';
import { OrderSettlementService } from '../order/order-settlement.service';
import { RuntimeCheckoutService } from '../runtime/runtime-checkout.service';
import { SessionStatusLogRepository } from '../runtime/session-status-log.repository';
import { RuntimeIngestService } from '../runtime-ingest/runtime-ingest.service';
import { isNonReplayableRealtimeActionCode } from './device-command-dispatch-policy';
import { buildScanControllerTrialSpec } from './scan-controller-trial.contract';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_MANAGER_ID = '00000000-0000-0000-0000-000000000102';
const DEFAULT_OPERATOR_ID = '00000000-0000-0000-0000-000000000103';
const SUPPORTED_PLATFORM_QUERY_CODES = new Set([
  'query_common_status',
  'query_workflow_state',
  'query_electric_meter',
  'query_upgrade_status',
  'query_upgrade_capability',
]);
const SUPPORTED_PLATFORM_ACTION_CODES = new Set([
  'start_pump',
  'stop_pump',
  'open_valve',
  'close_valve',
  'pause_session',
  'resume_session',
  'upgrade_firmware',
  'ota_prepare',
  'ota_start',
  'ota_cancel',
  'ota_commit',
  'ota_rollback',
  'play_voice_prompt',
]);

type ResolvedDevice = {
  id: string;
  imei: string;
  deviceCode: string;
  deviceName: string | null;
  onlineState: string | null;
  runtimeState: string | null;
  projectId: string | null;
  blockId: string | null;
  sourceNodeCode: string | null;
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
  requestPayload: Record<string, unknown>;
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
  requestMsgId: string | null;
  requestSeqNo: number | null;
  startToken: string | null;
  sentAt: string | null;
  ackedAt: string | null;
  requestPayload: Record<string, unknown>;
};

type RealtimeDispatchCandidate = {
  id: string;
  commandToken: string;
  commandCode: string;
  commandStatus: string;
  targetDeviceId: string | null;
  imei: string;
  sessionId: string | null;
  sessionRef: string | null;
  requestMsgId: string | null;
  requestSeqNo: number | null;
  startToken: string | null;
  requestPayload: Record<string, unknown>;
  wireMessage: Record<string, unknown>;
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

type DeviceGatewayCommandRecord = {
  id: string;
  commandToken: string;
  commandCode: string;
  commandStatus: string;
  imei: string;
  targetDeviceId: string | null;
  sessionId: string | null;
  sessionRef: string | null;
  requestMsgId: string | null;
  requestSeqNo: number | null;
  ackMsgId: string | null;
  ackSeqNo: number | null;
  sentAt: string | null;
  ackedAt: string | null;
  failedAt: string | null;
  timeoutAt: string | null;
  createdAt: string;
  updatedAt: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  wireMessage?: Record<string, unknown>;
  deviceCode: string | null;
  deviceName: string | null;
};

type TcpAuditLogRecord = {
  id: string;
  transportType: string;
  direction: string;
  connectionId: string;
  remoteAddr: string | null;
  remotePort: number | null;
  imei: string | null;
  msgType: string | null;
  protocolVersion: string | null;
  frameSizeBytes: number;
  parseStatus: string;
  ingestStatus: string;
  ingestError: string | null;
  rawFrameText: string;
  requestSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type DeviceInteractionLogRecord = {
  source: 'v2' | 'legacy';
  id: string;
  tenantId: string;
  deviceId: string | null;
  imei: string;
  deviceCode: string | null;
  deviceName: string | null;
  connectionId: string | null;
  protocolVersion: string | null;
  direction: string;
  msgId: string | null;
  seqNo: number | null;
  msgType: string;
  eventType: string | null;
  sessionRef: string | null;
  commandId: string | null;
  commandToken: string | null;
  commandCode: string | null;
  commandStatus: string | null;
  deviceTs: string | null;
  serverRxTs: string;
  integrityOk: boolean;
  payloadSizeBytes: number;
  payloadPreview: Record<string, unknown>;
  payload: Record<string, unknown>;
  rawBodyText: string | null;
  rawBodyRef: string | null;
  storageTier: string;
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

type DispatchQueryInput = {
  target_device_id?: string | null;
  imei?: string | null;
  session_id?: string | null;
  session_ref?: string | null;
  query_code?: string | null;
  scope?: string | null;
  module_code?: string | null;
  module_instance_code?: string | null;
  channel_code?: string | null;
  metric_codes?: string[] | null;
  payload?: Record<string, unknown> | null;
  source?: string | null;
};

type DispatchExecuteActionInput = {
  target_device_id?: string | null;
  imei?: string | null;
  session_id?: string | null;
  session_ref?: string | null;
  order_id?: string | null;
  action_code?: string | null;
  scope?: string | null;
  module_code?: string | null;
  module_instance_code?: string | null;
  channel_code?: string | null;
  payload?: Record<string, unknown> | null;
  start_token?: string | null;
  source?: string | null;
};

type DispatchSyncConfigInput = {
  target_device_id?: string | null;
  imei?: string | null;
  session_id?: string | null;
  session_ref?: string | null;
  config_version?: number | null;
  firmware_family?: string | null;
  feature_modules?: string[] | null;
  channel_bindings?: unknown[] | null;
  runtime_rules?: Record<string, unknown> | null;
  resource_inventory?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  source?: string | null;
};

type CardSwipeBridgeResult = {
  handled: boolean;
  accepted: boolean;
  action: string | null;
  sessionId: string | null;
  sessionRef: string | null;
  orderId: string | null;
  awaitingDeviceAck: boolean;
  promptCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuedCommandCount: number;
  responseSnapshot: Record<string, unknown>;
};

@Injectable()
export class DeviceGatewayService {
  private readonly transportEnvelopeKeys = new Set([
    'v',
    't',
    'i',
    'm',
    's',
    'c',
    'r',
    'p',
    'ts',
    'integrity'
  ]);
  private runtimeCheckoutService: RuntimeCheckoutService | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
    private readonly adapter: TcpJsonV1Adapter,
    private readonly orderRepository: OrderRepository,
    private readonly orderSettlementService: OrderSettlementService,
    private readonly sessionStatusLogRepository: SessionStatusLogRepository,
    private readonly runtimeIngestService: RuntimeIngestService,
    private readonly moduleRef: ModuleRef
  ) {}

  getProtocolName() {
    return 'hj-device-v2';
  }

  getScanControllerTrialRegisterSpec() {
    return buildScanControllerTrialSpec({
      protocol_name: this.getProtocolName(),
      transport_policy: this.getTransportPolicy(),
    });
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

  private normalizeWireMsgType(value: unknown) {
    const normalized = this.asString(value).toUpperCase();
    if (!normalized) return '';
    if (normalized === 'RG') return 'REGISTER';
    if (normalized === 'HB') return 'HEARTBEAT';
    if (normalized === 'SS') return 'STATE_SNAPSHOT';
    if (normalized === 'ER') return 'EVENT_REPORT';
    if (normalized === 'QR') return 'QUERY';
    if (normalized === 'QS') return 'QUERY_RESULT';
    if (normalized === 'EX') return 'EXECUTE_ACTION';
    if (normalized === 'SC') return 'SYNC_CONFIG';
    if (normalized === 'AK') return 'COMMAND_ACK';
    if (normalized === 'NK') return 'COMMAND_NACK';
    return normalized;
  }

  private toWireMsgType(value: string) {
    const normalized = this.normalizeWireMsgType(value);
    if (normalized === 'REGISTER') return 'RG';
    if (normalized === 'HEARTBEAT') return 'HB';
    if (normalized === 'STATE_SNAPSHOT') return 'SS';
    if (normalized === 'EVENT_REPORT') return 'ER';
    if (normalized === 'QUERY') return 'QR';
    if (normalized === 'QUERY_RESULT') return 'QS';
    if (normalized === 'EXECUTE_ACTION') return 'EX';
    if (normalized === 'SYNC_CONFIG') return 'SC';
    if (normalized === 'COMMAND_ACK') return 'AK';
    if (normalized === 'COMMAND_NACK') return 'NK';
    return normalized;
  }

  private toWireScopeCode(value: unknown) {
    const normalized = this.normalizeScope(value);
    if (normalized === 'common') return 'cm';
    if (normalized === 'module') return 'md';
    if (normalized === 'workflow') return 'wf';
    return normalized;
  }

  private toWireModuleCode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'pump_vfd_control') return 'pvc';
    if (normalized === 'pump_direct_control') return 'pdc';
    if (normalized === 'single_valve_control') return 'svl';
    if (normalized === 'electric_meter_modbus') return 'ebr';
    if (normalized === 'breaker_control') return 'bkr';
    if (normalized === 'breaker_feedback_monitor') return 'bkf';
    if (normalized === 'pressure_acquisition') return 'prs';
    if (normalized === 'flow_acquisition') return 'flw';
    if (normalized === 'soil_moisture_acquisition') return 'sma';
    if (normalized === 'soil_temperature_acquisition') return 'sta';
    if (normalized === 'power_monitoring') return 'pwm';
    if (normalized === 'payment_qr_control') return 'pay';
    if (normalized === 'card_auth_reader') return 'cdr';
    if (normalized === 'valve_feedback_monitor') return 'vfb';
    return normalized;
  }

  private toWireQueryCode(value: unknown) {
    const normalized = this.normalizeSupportedQueryCode(value);
    if (!normalized) return '';
    if (normalized === 'query_common_status') return 'qcs';
    if (normalized === 'query_workflow_state') return 'qwf';
    if (normalized === 'query_electric_meter') return 'qem';
    if (normalized === 'query_upgrade_status') return 'qgs';
    if (normalized === 'query_upgrade_capability') return 'qgc';
    return normalized;
  }

  private toWireActionCode(value: unknown) {
    const normalized = this.normalizeSupportedActionCode(value);
    if (!normalized) return '';
    if (normalized === 'play_voice_prompt') return 'ppu';
    if (normalized === 'upgrade_firmware') return 'upg';
    if (normalized === 'pause_session') return 'pas';
    if (normalized === 'resume_session') return 'res';
    if (normalized === 'start_pump') return 'spu';
    if (normalized === 'stop_pump') return 'tpu';
    if (normalized === 'open_valve') return 'ovl';
    if (normalized === 'close_valve') return 'cvl';
    return normalized;
  }

  private toWireMetricCode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'pressure_mpa') return 'pr';
    if (normalized === 'flow_m3h') return 'fm';
    if (normalized === 'power_kw') return 'pw';
    if (normalized === 'voltage_v') return 'vv';
    if (normalized === 'current_a') return 'ia';
    if (normalized === 'energy_wh') return 'ew';
    if (normalized === 'energy_kwh') return 'ek';
    if (normalized === 'total_m3') return 'fq';
    if (normalized === 'runtime_sec') return 'rt';
    if (normalized === 'battery_soc') return 'bs';
    if (normalized === 'battery_voltage_v') return 'bv';
    if (normalized === 'solar_voltage_v') return 'sv';
    if (normalized === 'signal_csq') return 'csq';
    if (normalized === 'breaker_state') return 'brs';
    if (normalized === 'meter_protocol') return 'mp';
    if (normalized === 'control_protocol') return 'cp';
    return normalized;
  }

  private toWireFeatureModules(value: unknown) {
    return this.asStringArray(value).map((item) => this.toWireModuleCode(item)).filter((item) => Boolean(item));
  }

  private getRuntimeCheckoutService() {
    if (!this.runtimeCheckoutService) {
      this.runtimeCheckoutService = this.moduleRef.get(RuntimeCheckoutService, { strict: false });
    }
    if (!this.runtimeCheckoutService) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, 'Runtime checkout service is unavailable');
    }
    return this.runtimeCheckoutService;
  }

  private extractEventCode(event: DeviceRuntimeEvent) {
    return this.asString(event.payload.event_code ?? event.payload.eventCode).toLowerCase();
  }

  private isCardSwipeRequestedEvent(event: DeviceRuntimeEvent) {
    return event.eventType === 'DEVICE_CARD_SWIPE_REQUESTED' || this.extractEventCode(event) === 'card_swipe_requested';
  }

  private isCardSwipeMetadataEvent(event: DeviceRuntimeEvent) {
    const eventCode = this.extractEventCode(event);
    return (
      event.eventType === 'DEVICE_CARD_SWIPE_REQUESTED' ||
      event.eventType === 'DEVICE_CARD_SWIPE_REJECTED' ||
      eventCode === 'card_swipe_requested' ||
      eventCode === 'card_swipe_rejected'
    );
  }

  private normalizeQueuedCommandCount(response: Record<string, unknown>) {
    const queuedCommands = Array.isArray(response.queued_commands) ? response.queued_commands : [];
    return queuedCommands.length;
  }

  private mapCardSwipeFailurePrompt(error: unknown) {
    if (!(error instanceof AppException)) {
      return 'unavailable';
    }

    const payload = error.getResponse() as {
      code?: string;
      message?: string;
      data?: Record<string, unknown>;
    };
    const code = this.asString(payload?.code).toUpperCase();
    const message = this.asString(payload?.message).toLowerCase();

    if (code === ErrorCodes.WALLET_INSUFFICIENT_BALANCE) {
      return 'insufficient_balance';
    }
    if (code === ErrorCodes.TARGET_NOT_FOUND) {
      return message.includes('card') ? 'invalid_card' : 'unavailable';
    }
    if (
      code === ErrorCodes.CONCURRENCY_LIMIT_REACHED ||
      code === ErrorCodes.ORDER_ALREADY_EXISTS ||
      code === ErrorCodes.FORBIDDEN ||
      code === ErrorCodes.DECISION_NOT_ALLOWED ||
      code === ErrorCodes.SESSION_NOT_STOPPABLE ||
      code === ErrorCodes.STARTUP_TIMEOUT
    ) {
      return 'port_busy';
    }
    if (
      code === ErrorCodes.SAFETY_PROTECTION_TRIGGERED ||
      code === ErrorCodes.POLICY_NOT_EFFECTIVE ||
      code === ErrorCodes.RELATION_NOT_CONFIGURED ||
      code === ErrorCodes.RELATION_FORBIDDEN
    ) {
      return 'device_fault';
    }
    if (code === ErrorCodes.DEVICE_OFFLINE) {
      return 'unavailable';
    }
    return 'unavailable';
  }

  private async queueSwipeFeedbackPrompt(imei: string, promptCode: string, client: PoolClient) {
    return this.queueCommandInClient(
      {
        imei,
        command_code: 'EXECUTE_ACTION',
        request_payload: {
          scope: 'common',
          action_code: 'play_voice_prompt',
          prompt_code: promptCode,
          prompt_source: 'platform_card_checkout',
          clear_queue: true,
          min_gap_ms: 300
        },
        source: 'device_gateway.card_swipe_feedback'
      },
      client
    );
  }

  private resolveCardSwipeJournalCategory(responseSnapshot: Record<string, unknown>) {
    if (this.asString(responseSnapshot.error_code) || this.asString(responseSnapshot.errorCode)) {
      return 'platform_explicit_reject';
    }
    if (this.asBoolean(responseSnapshot.awaiting_device_ack)) {
      return 'pending_device_ack';
    }
    if (this.asString(responseSnapshot.action)) {
      return 'accepted';
    }
    return 'platform_processing';
  }

  private async upsertCardSwipeJournal(input: {
    userId?: string | null;
    imei: string;
    cardToken?: string | null;
    swipeAction: string;
    swipeEventId: string;
    swipeAt?: string | null;
    requestSnapshot?: Record<string, unknown>;
    responseSnapshot?: Record<string, unknown>;
    resultCategory?: string | null;
    resultCode?: string | null;
    resultMessage?: string | null;
    awaitingDeviceAck?: boolean;
    resolvedAt?: string | null;
    client: PoolClient;
  }) {
    await this.db.query(
      `
      insert into card_swipe_event (
        tenant_id, user_id, imei, card_token, swipe_action, swipe_event_id, swipe_at,
        request_snapshot_json, response_snapshot_json,
        result_category, result_code, result_message, awaiting_device_ack, resolved_at
      )
      values (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz,
        $8::jsonb, $9::jsonb,
        $10, $11, $12, $13, $14::timestamptz
      )
      on conflict (tenant_id, swipe_event_id) do update
      set user_id = coalesce(card_swipe_event.user_id, excluded.user_id),
          imei = coalesce(nullif(card_swipe_event.imei, ''), excluded.imei),
          card_token = coalesce(card_swipe_event.card_token, excluded.card_token),
          swipe_action = coalesce(nullif(card_swipe_event.swipe_action, ''), excluded.swipe_action),
          swipe_at = coalesce(card_swipe_event.swipe_at, excluded.swipe_at),
          request_snapshot_json = coalesce(card_swipe_event.request_snapshot_json, '{}'::jsonb) || excluded.request_snapshot_json,
          response_snapshot_json = coalesce(card_swipe_event.response_snapshot_json, '{}'::jsonb) || excluded.response_snapshot_json,
          result_category = coalesce(excluded.result_category, card_swipe_event.result_category),
          result_code = coalesce(excluded.result_code, card_swipe_event.result_code),
          result_message = coalesce(excluded.result_message, card_swipe_event.result_message),
          awaiting_device_ack = excluded.awaiting_device_ack,
          resolved_at = coalesce(excluded.resolved_at, card_swipe_event.resolved_at),
          updated_at = now()
      `,
      [
        TENANT_ID,
        input.userId ?? null,
        input.imei,
        this.asString(input.cardToken) || null,
        this.asString(input.swipeAction) || 'unknown',
        input.swipeEventId,
        this.toIsoTimestamp(input.swipeAt ?? null),
        JSON.stringify(input.requestSnapshot ?? {}),
        JSON.stringify(input.responseSnapshot ?? {}),
        input.resultCategory ?? null,
        input.resultCode ?? null,
        input.resultMessage ?? null,
        Boolean(input.awaitingDeviceAck),
        this.toIsoTimestamp(input.resolvedAt ?? null)
      ],
      input.client
    );
  }

  private async bridgeCardSwipeRequestedEvent(event: DeviceRuntimeEvent, client: PoolClient): Promise<CardSwipeBridgeResult> {
    const payload = this.asObject(event.payload);
    const cardToken =
      this.asString(payload.card_token) ||
      this.asString(payload.cardToken) ||
      this.asString(payload.access_token) ||
      this.asString(payload.accessToken);
    const swipeAction = this.asString(payload.swipe_action ?? payload.swipeAction).toLowerCase();
    const normalizedSwipeAction = swipeAction === 'start' || swipeAction === 'stop' ? swipeAction : null;
    const swipeEventId = this.asString(payload.swipe_event_id ?? payload.swipeEventId) || event.msgId;
    const swipeAt = this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs) ?? new Date().toISOString();
    const journalRequestSnapshot = {
      imei: event.imei,
      swipe_action: normalizedSwipeAction ?? 'unknown',
      swipe_event_id: swipeEventId,
      swipe_at: swipeAt,
      gateway_event_type: event.eventType,
      gateway_msg_id: event.msgId,
      gateway_seq_no: event.seqNo,
      gateway_payload: payload
    };

    await this.upsertCardSwipeJournal({
      imei: event.imei,
      cardToken: cardToken || null,
      swipeAction: normalizedSwipeAction ?? 'unknown',
      swipeEventId,
      swipeAt,
      requestSnapshot: journalRequestSnapshot,
      resultCategory: 'platform_processing',
      awaitingDeviceAck: false,
      client
    });

    if (!cardToken) {
      const queuedPromptCount = (await this.queueSwipeFeedbackPrompt(event.imei, 'invalid_card', client).then(() => 1).catch(() => 0));
      const responseSnapshot = {
        error_code: ErrorCodes.VALIDATION_ERROR,
        error_message: 'card_token is missing from device swipe event',
        prompt_code: 'invalid_card',
        queued_command_count: queuedPromptCount
      };
      await this.upsertCardSwipeJournal({
        imei: event.imei,
        swipeAction: normalizedSwipeAction ?? 'unknown',
        swipeEventId,
        swipeAt,
        requestSnapshot: journalRequestSnapshot,
        responseSnapshot,
        resultCategory: 'platform_explicit_reject',
        resultCode: ErrorCodes.VALIDATION_ERROR,
        resultMessage: 'card_token is missing from device swipe event',
        awaitingDeviceAck: false,
        resolvedAt: swipeAt,
        client
      });
      return {
        handled: true,
        accepted: false,
        action: null,
        sessionId: null,
        sessionRef: null,
        orderId: null,
        awaitingDeviceAck: false,
        promptCode: 'invalid_card',
        errorCode: ErrorCodes.VALIDATION_ERROR,
        errorMessage: 'card_token is missing from device swipe event',
        queuedCommandCount: queuedPromptCount,
        responseSnapshot
      };
    }

    try {
      const checkoutService = this.getRuntimeCheckoutService();
      const response = this.asObject(
        await checkoutService.handleCardSwipe(event.imei, cardToken, normalizedSwipeAction, swipeEventId, swipeAt)
      );

      return {
        handled: true,
        accepted: true,
        action: this.asString(response.action) || null,
        sessionId: this.asString(response.session_id) || null,
        sessionRef: this.asString(response.session_ref) || null,
        orderId: this.asString(response.order_id) || null,
        awaitingDeviceAck: this.asBoolean(response.awaiting_device_ack),
        promptCode: null,
        errorCode: null,
        errorMessage: null,
        queuedCommandCount: this.normalizeQueuedCommandCount(response),
        responseSnapshot: response
      };
    } catch (error) {
      const promptCode = this.mapCardSwipeFailurePrompt(error);
      const queuedPromptCount = (await this.queueSwipeFeedbackPrompt(event.imei, promptCode, client).then(() => 1).catch(() => 0));

      if (error instanceof AppException) {
        const payload = error.getResponse() as {
          code?: string;
          message?: string;
          data?: Record<string, unknown>;
        };
        const responseSnapshot = {
          ...this.asObject(payload?.data),
          error_code: this.asString(payload?.code) || ErrorCodes.INTERNAL_ERROR,
          error_message: this.asString(payload?.message) || 'card swipe checkout failed',
          prompt_code: promptCode,
          queued_command_count: queuedPromptCount
        };
        await this.upsertCardSwipeJournal({
          imei: event.imei,
          cardToken,
          swipeAction: normalizedSwipeAction ?? 'unknown',
          swipeEventId,
          swipeAt,
          requestSnapshot: journalRequestSnapshot,
          responseSnapshot,
          resultCategory: this.resolveCardSwipeJournalCategory(responseSnapshot),
          resultCode: this.asString(payload?.code) || ErrorCodes.INTERNAL_ERROR,
          resultMessage: this.asString(payload?.message) || 'card swipe checkout failed',
          awaitingDeviceAck: false,
          resolvedAt: swipeAt,
          client
        });
        return {
          handled: true,
          accepted: false,
          action: null,
          sessionId: null,
          sessionRef: null,
          orderId: null,
          awaitingDeviceAck: false,
          promptCode,
          errorCode: this.asString(payload?.code) || ErrorCodes.INTERNAL_ERROR,
          errorMessage: this.asString(payload?.message) || 'card swipe checkout failed',
          queuedCommandCount: queuedPromptCount,
          responseSnapshot
        };
      }

      const responseSnapshot = {
        error_code: ErrorCodes.INTERNAL_ERROR,
        error_message: 'card swipe checkout failed',
        prompt_code: promptCode,
        queued_command_count: queuedPromptCount
      };
      await this.upsertCardSwipeJournal({
        imei: event.imei,
        cardToken,
        swipeAction: normalizedSwipeAction ?? 'unknown',
        swipeEventId,
        swipeAt,
        requestSnapshot: journalRequestSnapshot,
        responseSnapshot,
        resultCategory: 'platform_explicit_reject',
        resultCode: ErrorCodes.INTERNAL_ERROR,
        resultMessage: 'card swipe checkout failed',
        awaitingDeviceAck: false,
        resolvedAt: swipeAt,
        client
      });

      return {
        handled: true,
        accepted: false,
        action: null,
        sessionId: null,
        sessionRef: null,
        orderId: null,
        awaitingDeviceAck: false,
        promptCode,
        errorCode: ErrorCodes.INTERNAL_ERROR,
        errorMessage: 'card swipe checkout failed',
        queuedCommandCount: queuedPromptCount,
        responseSnapshot
      };
    }
  }

  private classifyDeviceCardSwipeOutcome(event: DeviceRuntimeEvent) {
    const reasonCode =
      this.asString(event.payload.reason_code ?? event.payload.reasonCode) ||
      this.asString(event.payload.error_code ?? event.payload.errorCode) ||
      this.asString(event.payload.event_code ?? event.payload.eventCode) ||
      'device_rejected';
    const reasonText =
      this.asString(event.payload.reason_text ?? event.payload.reasonText) ||
      this.asString(event.payload.error_message ?? event.payload.errorMessage) ||
      this.asString(event.payload.message) ||
      null;
    const normalizedReason = reasonCode.toLowerCase();

    if (normalizedReason.includes('timeout')) {
      return {
        category: 'device_local_timeout',
        code: reasonCode,
        message: reasonText || 'device local auth timeout'
      };
    }

    return {
      category: 'platform_explicit_reject',
      code: reasonCode,
      message: reasonText || 'device reported auth reject'
    };
  }

  private async syncCardSwipeOutcomeFromEvent(event: DeviceRuntimeEvent, client: PoolClient) {
    if (event.eventType !== 'DEVICE_CARD_SWIPE_REJECTED') {
      return;
    }

    const swipeEventId =
      this.asString(event.payload.swipe_event_id ?? event.payload.swipeEventId) ||
      this.asString(event.payload.request_msg_id ?? event.payload.requestMsgId) ||
      this.asString(event.payload.correlation_id ?? event.payload.correlationId) ||
      null;
    if (!swipeEventId) {
      return;
    }

    const outcome = this.classifyDeviceCardSwipeOutcome(event);
    await this.db.query(
      `
      update card_swipe_event
      set result_category = $3,
          result_code = $4,
          result_message = $5,
          awaiting_device_ack = false,
          resolved_at = coalesce($6::timestamptz, now()),
          response_snapshot_json = coalesce(response_snapshot_json, '{}'::jsonb) || $7::jsonb,
          updated_at = now()
      where tenant_id = $1
        and imei = $2
        and swipe_event_id = $8
      `,
      [
        TENANT_ID,
        event.imei,
        outcome.category,
        outcome.code,
        outcome.message,
        this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs),
        JSON.stringify({
          device_result_category: outcome.category,
          device_result_code: outcome.code,
          device_result_message: outcome.message,
          gateway_event_type: event.eventType,
          gateway_msg_id: event.msgId
        }),
        swipeEventId
      ],
      client
    );
  }

  private async markPendingCardSwipeInterrupted(imei: string, client: PoolClient) {
    await this.db.query(
      `
      update card_swipe_event
      set result_category = 'connection_interrupted_pending',
          result_code = 'connection_disconnected',
          result_message = 'device connection closed before auth flow resolved',
          awaiting_device_ack = false,
          resolved_at = coalesce(resolved_at, now()),
          updated_at = now()
      where tenant_id = $1
        and imei = $2
        and result_category = 'pending_device_ack'
        and resolved_at is null
        and created_at >= now() - interval '30 minutes'
      `,
      [TENANT_ID, imei],
      client
    );
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

  private normalizeScope(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'common' || normalized === 'module' || normalized === 'workflow') {
      return normalized;
    }
    return 'module';
  }

  private normalizeSupportedQueryCode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'qcs' || normalized === 'query_common_status') return 'query_common_status';
    if (normalized === 'qwf' || normalized === 'query_workflow_state') return 'query_workflow_state';
    if (
      normalized === 'qem' ||
      normalized === 'query_electric_meter' ||
      normalized === 'query_meter_snapshot'
    ) {
      return 'query_electric_meter';
    }
    if (normalized === 'query_upgrade_status') return 'query_upgrade_status';
    if (normalized === 'query_upgrade_capability') return 'query_upgrade_capability';
    return normalized;
  }

  private normalizeSupportedActionCode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'ppu' || normalized === 'play_voice_prompt') return 'play_voice_prompt';
    if (normalized === 'upg' || normalized === 'upgrade_firmware') return 'upgrade_firmware';
    if (normalized === 'ota_prepare') return 'ota_prepare';
    if (normalized === 'ota_start') return 'ota_start';
    if (normalized === 'ota_cancel') return 'ota_cancel';
    if (normalized === 'ota_commit') return 'ota_commit';
    if (normalized === 'ota_rollback') return 'ota_rollback';
    if (normalized === 'pas' || normalized === 'pause_session') return 'pause_session';
    if (normalized === 'res' || normalized === 'resume_session') return 'resume_session';
    if (normalized === 'spu' || normalized === 'start_pump') return 'start_pump';
    if (normalized === 'tpu' || normalized === 'stop_pump') return 'stop_pump';
    if (normalized === 'ovl' || normalized === 'open_valve') return 'open_valve';
    if (normalized === 'cvl' || normalized === 'close_valve') return 'close_valve';
    return normalized;
  }

  private ensureCommandCode(value: unknown, fieldName: string) {
    const normalized = this.asString(value).toLowerCase();
    if (!normalized) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, `${fieldName} is required`);
    }
    return normalized;
  }

  private ensureSupportedQueryCode(value: unknown) {
    const normalized = this.normalizeSupportedQueryCode(value);
    if (!normalized) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'query_code is required');
    }
    if (!SUPPORTED_PLATFORM_QUERY_CODES.has(normalized)) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `query_code ${normalized} is not supported by the short-protocol scan controller`,
      );
    }
    return normalized;
  }

  private ensureSupportedActionCode(value: unknown) {
    const normalized = this.normalizeSupportedActionCode(value);
    if (!normalized) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'action_code is required');
    }
    if (!SUPPORTED_PLATFORM_ACTION_CODES.has(normalized)) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `action_code ${normalized} is not supported by the short-protocol scan controller`,
      );
    }
    return normalized;
  }

  private resolveQueryScope(queryCode: string, requestedScope: unknown) {
    if (queryCode === 'query_workflow_state') return 'workflow';
    if (
      queryCode === 'query_common_status' ||
      queryCode === 'query_electric_meter' ||
      queryCode === 'query_upgrade_status' ||
      queryCode === 'query_upgrade_capability'
    ) {
      return 'common';
    }
    return this.normalizeScope(requestedScope);
  }

  private resolveActionScope(actionCode: string, requestedScope: unknown) {
    if (actionCode === 'pause_session' || actionCode === 'resume_session') return 'workflow';
    if (
      actionCode === 'play_voice_prompt' ||
      actionCode === 'upgrade_firmware' ||
      actionCode === 'ota_prepare' ||
      actionCode === 'ota_start' ||
      actionCode === 'ota_cancel' ||
      actionCode === 'ota_commit' ||
      actionCode === 'ota_rollback'
    ) {
      return 'common';
    }
    if (['start_pump', 'stop_pump', 'open_valve', 'close_valve'].includes(actionCode)) return 'module';
    return this.normalizeScope(requestedScope);
  }

  private resolveActionModuleCode(actionCode: string, requestedModuleCode: unknown) {
    if (actionCode === 'start_pump' || actionCode === 'stop_pump') return 'pump_direct_control';
    if (actionCode === 'open_valve' || actionCode === 'close_valve') return 'single_valve_control';
    const normalized = this.asString(requestedModuleCode);
    return normalized || null;
  }

  private resolveActionTargetRef(actionCode: string, payload: Record<string, unknown>, channelCode?: unknown) {
    const explicitTargetRef =
      this.asString(payload.target_ref) ||
      this.asString(payload.target_channel_code) ||
      this.asString(channelCode);
    if (explicitTargetRef) {
      return explicitTargetRef;
    }
    if (actionCode === 'start_pump' || actionCode === 'stop_pump') return 'pump_1';
    if (actionCode === 'open_valve' || actionCode === 'close_valve') return 'valve_1';
    return null;
  }

  private resolveSessionLegacyAction(
    payload: Record<string, unknown>,
    pumpAction: 'start_pump' | 'stop_pump',
    valveAction: 'open_valve' | 'close_valve',
  ) {
    const explicitAction = this.normalizeSupportedActionCode(payload.action_code);
    if (SUPPORTED_PLATFORM_ACTION_CODES.has(explicitAction)) {
      return explicitAction;
    }
    const moduleCode = this.asString(payload.module_code).toLowerCase();
    const targetType = this.asString(payload.target_type).toLowerCase();
    const targetRef =
      this.asString(payload.target_ref || payload.target_channel_code || payload.channel_code).toLowerCase();
    if (
      targetType === 'valve' ||
      moduleCode === 'single_valve_control' ||
      targetRef.startsWith('valve')
    ) {
      return valveAction;
    }
    return pumpAction;
  }

  private extractEventPayload(input: Record<string, unknown>) {
    const explicitPayload = this.asObject(input.p);
    const fallbackPayload = Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (!this.transportEnvelopeKeys.has(key)) {
        acc[key] = value;
      }
      return acc;
    }, {});

    return {
      ...fallbackPayload,
      ...explicitPayload
    };
  }

  private buildDefaultRequestMsgId(commandToken: string) {
    return `cmd-${commandToken}`;
  }

  private buildDefaultRequestSeqNo(commandToken: string) {
    const maxSignedInt32 = 2147483647;
    const compact = commandToken.replace(/-/g, '').slice(0, 8);
    const parsed = compact ? Number.parseInt(compact, 16) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      const normalized = Math.trunc(parsed >>> 0) % maxSignedInt32;
      return normalized > 0 ? normalized : 1;
    }
    return Number(String(Date.now()).slice(-9));
  }

  private sanitizeWirePayload(value: Record<string, unknown>) {
    const payload = { ...this.asObject(value) };
    delete payload.source;
    delete payload.command_code;
    delete payload.command_id;
    delete payload.device_command_token;
    delete payload.target_device_id;
    delete payload.imei;
    delete payload.session_ref;
    delete payload.start_token;
    return payload;
  }

  private buildCompactCommandPayload(
    value: Record<string, unknown>,
    options?: { msgType?: string | null }
  ) {
    const source = this.sanitizeWirePayload(value);
    const compactPayload: Record<string, unknown> = {};
    const normalizedMsgType = this.normalizeWireMsgType(options?.msgType ?? '');
    const isExecute = normalizedMsgType === 'EXECUTE_ACTION';
    const isQuery = normalizedMsgType === 'QUERY';
    const assignString = (key: string, normalized: string) => {
      if (normalized) {
        compactPayload[key] = normalized;
      }
    };

    assignString('sc', this.toWireScopeCode(source.scope));
    assignString('qc', this.toWireQueryCode(source.query_code));
    assignString('ac', this.toWireActionCode(source.action_code));
    if (!isExecute) {
      assignString('mc', this.toWireModuleCode(source.module_code));
      assignString('mi', this.asString(source.module_instance_code));
      assignString('cc', this.asString(source.channel_code));
    }
    assignString('ff', this.asString(source.firmware_family));
    assignString('fv', this.asString(source.firmware_version));
    assignString('hs', this.asString(source.hardware_sku));
    assignString('hr', this.asString(source.hardware_rev));
    assignString('mp', this.asString(source.meter_protocol).toLowerCase());
    assignString('cp', this.asString(source.control_protocol).toLowerCase());
    assignString('brs', this.asString(source.breaker_state).toLowerCase());

    const configVersion = this.asNumber(source.config_version);
    if (configVersion !== null) {
      compactPayload.cv = Math.trunc(configVersion);
    }

    const featureModules = this.toWireFeatureModules(source.feature_modules);
    if (featureModules.length > 0) {
      compactPayload.fm = featureModules;
    }

    const metricCodes = Array.isArray(source.metric_codes)
      ? source.metric_codes.map((item) => this.toWireMetricCode(item)).filter((item) => Boolean(item))
      : [];
    if (metricCodes.length > 0) {
      compactPayload.ms = metricCodes;
    }

    if (Array.isArray(source.channel_bindings) && source.channel_bindings.length > 0) {
      compactPayload.cb = source.channel_bindings;
    }
    if (source.runtime_rules && typeof source.runtime_rules === 'object' && !Array.isArray(source.runtime_rules)) {
      compactPayload.rr = this.asObject(source.runtime_rules);
    }
    if (source.resource_inventory && typeof source.resource_inventory === 'object' && !Array.isArray(source.resource_inventory)) {
      compactPayload.ri = this.asObject(source.resource_inventory);
    }
    if (source.params && typeof source.params === 'object' && !Array.isArray(source.params)) {
      compactPayload.pm = this.asObject(source.params);
    }
    if (!isExecute && source.session_id !== undefined && source.session_id !== null && source.session_id !== '') {
      compactPayload.sid = source.session_id;
    }
    if (source.target_ref !== undefined && source.target_ref !== null && source.target_ref !== '') {
      compactPayload.tr = source.target_ref;
    }

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (
        [
          'scope',
          'query_code',
          'action_code',
          'module_code',
          'module_instance_code',
          'channel_code',
          'metric_codes',
          'config_version',
          'feature_modules',
          'firmware_family',
          'firmware_version',
          'hardware_sku',
          'hardware_rev',
          'channel_bindings',
          'runtime_rules',
          'resource_inventory',
          'params',
          'session_id',
          'target_ref',
          'start_token',
          'meter_protocol',
          'control_protocol',
          'breaker_state'
        ].includes(key)
      ) {
        continue;
      }
      if (isExecute) {
        continue;
      }
      if (isQuery && !['tr', 'pm'].includes(key)) {
        continue;
      }
      compactPayload[key] = value;
    }

    return compactPayload;
  }

  private buildWireCommandEnvelope(command: {
    commandToken: string;
    commandCode: string;
    imei: string;
    sessionRef: string | null;
    requestMsgId: string | null;
    requestSeqNo: number | null;
    requestPayload: Record<string, unknown>;
  }) {
    const normalizedCommandCode = this.asString(command.commandCode).toUpperCase();
    const payload = this.sanitizeWirePayload(command.requestPayload);
    let type = normalizedCommandCode;

    if (normalizedCommandCode === 'START_SESSION') {
      const actionCode = this.resolveSessionLegacyAction(payload, 'start_pump', 'open_valve');
      type = 'EXECUTE_ACTION';
      payload.scope = this.resolveActionScope(actionCode, payload.scope);
      payload.action_code = actionCode;
      payload.module_code = this.resolveActionModuleCode(actionCode, payload.module_code);
      payload.target_ref = this.resolveActionTargetRef(actionCode, payload, payload.channel_code);
      payload.channel_code = null;
      payload.session_id = this.asString(payload.session_id) || command.sessionRef || null;
    } else if (normalizedCommandCode === 'STOP_SESSION') {
      const actionCode = this.resolveSessionLegacyAction(payload, 'stop_pump', 'close_valve');
      type = 'EXECUTE_ACTION';
      payload.scope = this.resolveActionScope(actionCode, payload.scope);
      payload.action_code = actionCode;
      payload.module_code = this.resolveActionModuleCode(actionCode, payload.module_code);
      payload.target_ref = this.resolveActionTargetRef(actionCode, payload, payload.channel_code);
      payload.channel_code = null;
      payload.session_id = this.asString(payload.session_id) || command.sessionRef || null;
    } else if (normalizedCommandCode === 'START_PUMP') {
      type = 'EXECUTE_ACTION';
      payload.scope = this.resolveActionScope('start_pump', payload.scope);
      payload.module_code = this.resolveActionModuleCode('start_pump', payload.module_code);
      payload.action_code = 'start_pump';
      payload.target_ref = this.resolveActionTargetRef('start_pump', payload, payload.channel_code);
      payload.channel_code = null;
    } else if (normalizedCommandCode === 'STOP_PUMP') {
      type = 'EXECUTE_ACTION';
      payload.scope = this.resolveActionScope('stop_pump', payload.scope);
      payload.module_code = this.resolveActionModuleCode('stop_pump', payload.module_code);
      payload.action_code = 'stop_pump';
      payload.target_ref = this.resolveActionTargetRef('stop_pump', payload, payload.channel_code);
      payload.channel_code = null;
    } else if (normalizedCommandCode === 'OPEN_VALVE') {
      type = 'EXECUTE_ACTION';
      payload.scope = this.resolveActionScope('open_valve', payload.scope);
      payload.module_code = this.resolveActionModuleCode('open_valve', payload.module_code);
      payload.action_code = 'open_valve';
      payload.target_ref = this.resolveActionTargetRef('open_valve', payload, payload.channel_code);
      payload.channel_code = null;
    } else if (normalizedCommandCode === 'CLOSE_VALVE') {
      type = 'EXECUTE_ACTION';
      payload.scope = this.resolveActionScope('close_valve', payload.scope);
      payload.module_code = this.resolveActionModuleCode('close_valve', payload.module_code);
      payload.action_code = 'close_valve';
      payload.target_ref = this.resolveActionTargetRef('close_valve', payload, payload.channel_code);
      payload.channel_code = null;
    } else if (normalizedCommandCode === 'SYNC_STATE') {
      type = 'QUERY';
      payload.scope = this.resolveQueryScope('query_common_status', payload.scope);
      payload.query_code = 'query_common_status';
    } else if (normalizedCommandCode === 'QUERY') {
      type = 'QUERY';
      const queryCode = this.ensureSupportedQueryCode(payload.query_code);
      payload.query_code = queryCode;
      payload.scope = this.resolveQueryScope(queryCode, payload.scope);
    } else if (normalizedCommandCode === 'EXECUTE_ACTION') {
      type = 'EXECUTE_ACTION';
      const actionCode = this.ensureSupportedActionCode(payload.action_code);
      payload.action_code = actionCode;
      payload.scope = this.resolveActionScope(actionCode, payload.scope);
      payload.module_code = this.resolveActionModuleCode(actionCode, payload.module_code);
      payload.target_ref = this.resolveActionTargetRef(actionCode, payload, payload.channel_code);
      payload.channel_code = null;
    } else if (normalizedCommandCode === 'SYNC_CONFIG') {
      type = 'SYNC_CONFIG';
    } else {
      return null;
    }

    const envelope: Record<string, unknown> = {
      v: 1,
      t: this.toWireMsgType(type),
      i: command.imei,
      m: command.requestMsgId || this.buildDefaultRequestMsgId(command.commandToken),
      s: command.requestSeqNo ?? this.buildDefaultRequestSeqNo(command.commandToken),
      c: command.commandToken,
      p: this.buildCompactCommandPayload(payload, { msgType: type })
    };

    if (command.sessionRef) {
      envelope.r = command.sessionRef;
    }

    return envelope;
  }

  private buildWireMessageForRecord(command: {
    commandToken: string;
    commandCode: string;
    imei: string;
    sessionRef?: string | null;
    requestMsgId?: string | null;
    requestSeqNo?: number | null;
    requestPayload: Record<string, unknown>;
  }) {
    return this.buildWireCommandEnvelope({
      commandToken: command.commandToken,
      commandCode: command.commandCode,
      imei: command.imei,
      sessionRef: command.sessionRef ?? null,
      requestMsgId: command.requestMsgId ?? null,
      requestSeqNo: command.requestSeqNo ?? null,
      requestPayload: command.requestPayload
    }) ?? {};
  }

  private serializeCommandRecord(row: DeviceGatewayCommandRecord): DeviceGatewayCommandRecord {
    return {
      ...row,
      wireMessage: this.buildWireMessageForRecord({
        commandToken: row.commandToken,
        commandCode: row.commandCode,
        imei: row.imei,
        sessionRef: row.sessionRef,
        requestMsgId: row.requestMsgId,
        requestSeqNo: row.requestSeqNo,
        requestPayload: row.requestPayload
      })
    };
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

  private isSynchronousStartCommand(input: {
    commandCode?: string | null;
    requestPayload?: Record<string, unknown> | null;
  }) {
    const commandCode = this.asString(input.commandCode).toUpperCase();
    if (['START_SESSION', 'START_PUMP', 'OPEN_VALVE'].includes(commandCode)) {
      return true;
    }

    const payload = this.asObject(input.requestPayload);
    const commandPlan = this.asString(payload.command_plan ?? payload.commandPlan).toLowerCase();
    const requestedFrom = this.asString(payload.requested_from ?? payload.requestedFrom).toLowerCase();
    const startToken = this.asString(payload.start_token ?? payload.startToken).toLowerCase();

    return (
      requestedFrom === 'runtime_engine' &&
      (commandPlan === 'session_start' || commandPlan === 'session_start_integrated' || startToken.startsWith('start-'))
    );
  }

  private isSynchronousWorkflowControlCommand(input: {
    commandCode?: string | null;
    requestPayload?: Record<string, unknown> | null;
  }) {
    const commandCode = this.asString(input.commandCode).toUpperCase();
    const payload = this.asObject(input.requestPayload);
    const actionCode = this.asString(payload.action_code ?? payload.actionCode).toLowerCase();
    const commandPlan = this.asString(payload.command_plan ?? payload.commandPlan).toLowerCase();
    if (commandCode !== 'EXECUTE_ACTION') {
      return false;
    }
    return (
      actionCode === 'pause_session' ||
      actionCode === 'resume_session' ||
      commandPlan === 'session_pause' ||
      commandPlan === 'session_resume'
    );
  }

  private isSessionStopCommand(input: {
    commandCode?: string | null;
    requestPayload?: Record<string, unknown> | null;
  }) {
    const commandCode = this.asString(input.commandCode).toUpperCase();
    const payload = this.asObject(input.requestPayload);
    const commandPlan = this.asString(payload.command_plan ?? payload.commandPlan).toLowerCase();
    return (
      ['STOP_SESSION', 'STOP_PUMP', 'CLOSE_VALVE'].includes(commandCode) &&
      (commandPlan === 'session_stop' || commandPlan === 'session_stop_integrated')
    );
  }

  private isNonReplayableRealtimeControlCommand(input: {
    commandCode?: string | null;
    requestPayload?: Record<string, unknown> | null;
  }) {
    const commandCode = this.asString(input.commandCode).toUpperCase();
    if (
      ['START_SESSION', 'STOP_SESSION', 'START_PUMP', 'STOP_PUMP', 'OPEN_VALVE', 'CLOSE_VALVE'].includes(commandCode)
    ) {
      return true;
    }

    const payload = this.asObject(input.requestPayload);
    const actionCode = this.asString(payload.action_code ?? payload.actionCode).toLowerCase();
    return isNonReplayableRealtimeActionCode(actionCode);
  }

  private resolveWorkflowActionCode(commandDispatch: ResolvedCommandDispatch | null, event: DeviceRuntimeEvent) {
    return this.asString(
      commandDispatch?.requestPayload?.action_code ??
        commandDispatch?.requestPayload?.actionCode ??
        event.payload.action_code ??
        event.payload.actionCode
    ).toLowerCase();
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
    const synchronousStartCommand = this.isSynchronousStartCommand({
      commandCode: deviceCommand.commandCode,
      requestPayload: { ...this.asObject(deviceCommand.responsePayload), ...payload }
    });
    const synchronousWorkflowControlCommand = this.isSynchronousWorkflowControlCommand({
      commandCode: deviceCommand.commandCode,
      requestPayload: { ...this.asObject(deviceCommand.responsePayload), ...payload }
    });
    const nonReplayableRealtimeControlCommand = this.isNonReplayableRealtimeControlCommand({
      commandCode: deviceCommand.commandCode,
      requestPayload: { ...this.asObject(deviceCommand.responsePayload), ...payload }
    });
    const retryable =
      !forceDeadLetter &&
      !nonReplayableRealtimeControlCommand &&
      !synchronousStartCommand &&
      !synchronousWorkflowControlCommand &&
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
    const payload = this.extractEventPayload(input);
    const envelopeVersion = this.asNumber(input.v);
    const imei = this.asString(input.i);
    const msgId = this.asString(input.m);
    const msgType = this.normalizeWireMsgType(input.t);
    const seqNo = this.asNumber(input.s);
    const cumulativeEnergyWhFromPayload = this.asNumber(payload.ew);
    const cumulativeEnergyKwhFromPayload = this.asNumber(payload.ek);

    if (envelopeVersion !== 1 || !imei || !msgId || !msgType || seqNo === null) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'short envelope v/t/i/m/s is required and v must equal 1');
    }

    return {
      protocol: this.getProtocolName(),
      protocolVersion: `v${Math.trunc(envelopeVersion)}`,
      imei,
      msgId,
      seqNo,
      msgType,
      deviceTs: this.toIsoTimestamp(this.asString(input.ts)) ?? null,
      serverRxTs: new Date().toISOString(),
      correlationId: this.asString(input.c) || null,
      sessionRef: this.asString(input.r) || null,
      runState: this.asString(payload.run_state ?? payload.rs) || null,
      powerState: this.asString(payload.power_state ?? payload.ps) || null,
      alarmCodes: this.asStringArray(payload.alarm_codes ?? payload.al),
      cumulativeRuntimeSec: this.asNumber(payload.rt),
      cumulativeEnergyWh:
        cumulativeEnergyWhFromPayload ??
        (cumulativeEnergyKwhFromPayload === null ? null : cumulativeEnergyKwhFromPayload * 1000),
      cumulativeFlow: this.asNumber(payload.fq),
      payload,
      integrity: this.asObject(input.integrity)
    };
  }

  private buildDeviceExtPatch(event: DeviceRuntimeEvent) {
    const payload = this.asObject(event.payload);
    const identity = this.asObject(payload.identity);
    const patch: Record<string, unknown> = {};
    const assignString = (key: string, ...values: unknown[]) => {
      for (const value of values) {
        const normalized = this.asString(value);
        if (normalized) {
          patch[key] = normalized;
          return;
        }
      }
    };
    const assignNumber = (key: string, ...values: unknown[]) => {
      for (const value of values) {
        const normalized = this.asNumber(value);
        if (normalized !== null) {
          patch[key] = normalized;
          return;
        }
      }
    };
    const featureModules = this.asStringArray(payload.feature_modules ?? payload.featureModules);
    const resourceInventory = this.asObject(payload.resource_inventory ?? payload.resourceInventory);
    const runtimeRules = this.asObject(payload.runtime_rules ?? payload.runtimeRules);
    const controllerState = this.asObject(payload.controller_state ?? payload.controllerState);
    const commonStatus = this.asObject(payload.common_status ?? payload.commonStatus);

    assignString('software_family', payload.software_family, payload.softwareFamily, identity.software_family, identity.softwareFamily);
    assignString('software_version', payload.software_version, payload.softwareVersion, identity.software_version, identity.softwareVersion);
    assignString('hardware_sku', payload.hardware_sku, payload.hardwareSku, identity.hardware_sku, identity.hardwareSku);
    assignString('hardware_rev', payload.hardware_rev, payload.hardwareRev, identity.hardware_rev, identity.hardwareRev);
    assignString('firmware_family', payload.firmware_family, payload.firmwareFamily, identity.firmware_family, identity.firmwareFamily);
    assignString('firmware_version', payload.firmware_version, payload.firmwareVersion, identity.firmware_version, identity.firmwareVersion);
    assignString('controller_role', payload.controller_role, payload.controllerRole);
    assignString('deployment_mode', payload.deployment_mode, payload.deploymentMode);
    assignString(
      'meter_protocol',
      payload.meter_protocol,
      payload.meterProtocol,
      commonStatus.meter_protocol,
      commonStatus.meterProtocol
    );
    assignString(
      'control_protocol',
      payload.control_protocol,
      payload.controlProtocol,
      commonStatus.control_protocol,
      commonStatus.controlProtocol
    );
    assignString('iccid', payload.iccid, identity.iccid, payload.sim_iccid, commonStatus.iccid, commonStatus.sim_iccid);
    assignString('chip_sn', payload.chip_sn, payload.chipSn);
    assignString('module_model', payload.module_model, payload.moduleModel);
    assignNumber('config_version', payload.config_version, payload.configVersion);

    if (featureModules.length > 0) {
      patch.feature_modules = featureModules;
      patch.auto_identified = true;
    }
    if (Object.keys(resourceInventory).length > 0) {
      patch.resource_inventory = resourceInventory;
      patch.auto_identified = true;
    }
    if (Array.isArray(payload.channel_bindings ?? payload.channelBindings)) {
      patch.channel_bindings = payload.channel_bindings ?? payload.channelBindings;
    }
    if (Object.keys(runtimeRules).length > 0) {
      patch.runtime_rules = runtimeRules;
    }
    if (Object.keys(controllerState).length > 0) {
      patch.last_controller_state = controllerState;
    }
    if (Object.keys(commonStatus).length > 0) {
      patch.last_common_status = commonStatus;
    }
    if (event.eventType === 'DEVICE_REGISTERED') {
      patch.last_register_payload = payload;
      patch.auto_identified = true;
    }
    return patch;
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
        runtime_state as "runtimeState",
        nullif(ext_json->>'project_id', '') as "projectId",
        nullif(ext_json->>'block_id', '') as "blockId",
        nullif(ext_json->>'source_node_code', '') as "sourceNodeCode"
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
        runtime_state as "runtimeState",
        nullif(ext_json->>'project_id', '') as "projectId",
        nullif(ext_json->>'block_id', '') as "blockId",
        nullif(ext_json->>'source_node_code', '') as "sourceNodeCode"
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
        dispatch_status as "dispatchStatus",
        request_payload_json as "requestPayload"
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
        dispatch_status as "dispatchStatus",
        request_payload_json as "requestPayload"
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

  private truncateString(value: string, maxLength = 240) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  private buildPayloadPreview(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value ?? null;
    if (depth >= 3) {
      if (Array.isArray(value)) {
        return `[${value.length} items]`;
      }
      if (typeof value === 'object') {
        return '[object]';
      }
    }

    if (typeof value === 'string') {
      return this.truncateString(value, 240);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.slice(0, 8).map((item) => this.buildPayloadPreview(item, depth + 1));
    }
    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .slice(0, 24)
        .reduce<Record<string, unknown>>((acc, [key, current]) => {
          acc[key] = this.buildPayloadPreview(current, depth + 1);
          return acc;
        }, {});
    }
    return String(value);
  }

  private serializeRawBody(value: Record<string, unknown>) {
    return JSON.stringify(value, null, 2);
  }

  private buildInteractionLogPayloadArtifacts(payload: Record<string, unknown>) {
    const rawBodyText = this.serializeRawBody(payload);
    const payloadSizeBytes = Buffer.byteLength(rawBodyText, 'utf8');
    const canStoreInline = payloadSizeBytes <= 64 * 1024;
    return {
      payloadJson: payload,
      payloadPreviewJson: this.asObject(this.buildPayloadPreview(payload)),
      payloadSizeBytes,
      rawBodyText: canStoreInline ? rawBodyText : null,
      rawBodyRef: canStoreInline ? null : 'oversize:pending-object-store',
      storageTier: 'hot'
    };
  }

  private buildInteractionLogCursor(serverRxTs: string, id: string) {
    return Buffer.from(JSON.stringify({ serverRxTs, id }), 'utf8').toString('base64url');
  }

  private parseInteractionLogCursor(cursor: string | null | undefined) {
    const normalized = this.asString(cursor);
    if (!normalized) return null;
    try {
      const decoded = JSON.parse(Buffer.from(normalized, 'base64url').toString('utf8')) as {
        serverRxTs?: string;
        id?: string;
      };
      const serverRxTs = this.toIsoTimestamp(decoded.serverRxTs ?? null);
      const id = this.asString(decoded.id);
      if (!serverRxTs || !id) return null;
      return { serverRxTs, id };
    } catch {
      return null;
    }
  }

  private buildTcpAuditCursor(createdAt: string, id: string) {
    return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
  }

  private parseTcpAuditCursor(cursor: string | null | undefined) {
    const normalized = this.asString(cursor);
    if (!normalized) return null;
    try {
      const decoded = JSON.parse(Buffer.from(normalized, 'base64url').toString('utf8')) as {
        createdAt?: string;
        id?: string;
      };
      const createdAt = this.toIsoTimestamp(decoded.createdAt ?? null);
      const id = this.asString(decoded.id);
      if (!createdAt || !id) return null;
      return { createdAt, id };
    } catch {
      return null;
    }
  }

  private formatTcpAuditError(error: unknown) {
    if (error instanceof AppException) {
      const payload = error.getResponse() as {
        code?: string;
        message?: string;
      };
      const code = this.asString(payload?.code);
      const message = this.asString(payload?.message) || error.message;
      return code ? `${code}: ${message}` : message;
    }
    if (error instanceof Error) return error.message;
    return this.asString(error) || 'Unknown TCP audit error';
  }

  private classifyTcpAuditIngestStatus(error: unknown) {
    if (error instanceof AppException) {
      const status = error.getStatus();
      if (status >= 400 && status < 500) {
        return 'rejected' as const;
      }
    }
    return 'failed' as const;
  }

  async createTcpAuditLog(input: {
    connection_id?: string | null;
    transport_type?: string | null;
    direction?: string | null;
    remote_addr?: string | null;
    remote_port?: number | null;
    imei?: string | null;
    msg_type?: string | null;
    protocol_version?: string | null;
    frame_size_bytes?: number | null;
    raw_frame_text?: string | null;
    parse_status?: string | null;
    ingest_status?: string | null;
    ingest_error?: string | null;
    request_snapshot?: Record<string, unknown> | null;
  }) {
    const result = await this.db.query<{
      id: string;
      transportType: string;
      direction: string;
      connectionId: string;
      remoteAddr: string | null;
      remotePort: number | null;
      imei: string | null;
      msgType: string | null;
      protocolVersion: string | null;
      frameSizeBytes: number;
      parseStatus: string;
      ingestStatus: string;
      ingestError: string | null;
      rawFrameText: string;
      requestSnapshot: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>(
      `
      insert into device_tcp_audit_log (
        id, tenant_id, connection_id, transport_type, direction, remote_addr, remote_port,
        imei, msg_type, protocol_version, frame_size_bytes, raw_frame_text,
        parse_status, ingest_status, ingest_error, request_snapshot_json
      )
      values (
        $1::uuid, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16::jsonb
      )
      returning
        id::text as id,
        transport_type as "transportType",
        direction as direction,
        connection_id as "connectionId",
        remote_addr as "remoteAddr",
        remote_port as "remotePort",
        imei as imei,
        msg_type as "msgType",
        protocol_version as "protocolVersion",
        frame_size_bytes as "frameSizeBytes",
        parse_status as "parseStatus",
        ingest_status as "ingestStatus",
        ingest_error as "ingestError",
        raw_frame_text as "rawFrameText",
        request_snapshot_json as "requestSnapshot",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      `,
      [
        randomUUID(),
        TENANT_ID,
        this.asString(input.connection_id) || 'unknown',
        this.asString(input.transport_type) || 'tcp',
        this.asString(input.direction) || 'inbound',
        this.asString(input.remote_addr) || null,
        input.remote_port ?? null,
        this.asString(input.imei) || null,
        this.asString(input.msg_type) || null,
        this.asString(input.protocol_version) || null,
        Math.max(0, Math.trunc(Number(input.frame_size_bytes ?? 0) || 0)),
        typeof input.raw_frame_text === 'string' ? input.raw_frame_text : '',
        this.asString(input.parse_status) || 'parsed',
        this.asString(input.ingest_status) || 'pending',
        this.asString(input.ingest_error) || null,
        JSON.stringify(this.asObject(input.request_snapshot))
      ]
    );

    return result.rows[0];
  }

  async finalizeTcpAuditLog(
    auditLogId: string | null | undefined,
    input: {
      imei?: string | null;
      msg_type?: string | null;
      protocol_version?: string | null;
      parse_status?: string | null;
      ingest_status?: string | null;
      ingest_error?: string | null;
      request_snapshot?: Record<string, unknown> | null;
    }
  ) {
    const normalizedAuditLogId = this.asString(auditLogId);
    if (!this.looksLikeUuid(normalizedAuditLogId)) {
      return { updated: false, reason: 'invalid_audit_log_id' as const };
    }

    const result = await this.db.query<{ id: string }>(
      `
      update device_tcp_audit_log
      set imei = coalesce($3, imei),
          msg_type = coalesce($4, msg_type),
          protocol_version = coalesce($5, protocol_version),
          parse_status = coalesce($6, parse_status),
          ingest_status = coalesce($7, ingest_status),
          ingest_error = $8,
          request_snapshot_json = case
            when $9::jsonb = '{}'::jsonb then request_snapshot_json
            else coalesce(request_snapshot_json, '{}'::jsonb) || $9::jsonb
          end,
          updated_at = now()
      where tenant_id = $1
        and id = $2::uuid
      returning id::text as id
      `,
      [
        TENANT_ID,
        normalizedAuditLogId,
        this.asString(input.imei) || null,
        this.asString(input.msg_type) || null,
        this.asString(input.protocol_version) || null,
        this.asString(input.parse_status) || null,
        this.asString(input.ingest_status) || null,
        input.ingest_error === undefined ? null : this.asString(input.ingest_error) || null,
        JSON.stringify(this.asObject(input.request_snapshot))
      ]
    );

    return {
      updated: Boolean(result.rows[0]),
      id: result.rows[0]?.id ?? normalizedAuditLogId
    };
  }

  async listTcpAuditLogs(params?: {
    imei?: string;
    connection_id?: string;
    direction?: string;
    parse_status?: string;
    ingest_status?: string;
    keyword?: string;
    start_at?: string;
    end_at?: string;
    cursor?: string;
    limit?: number;
  }) {
    const filters: string[] = ['tenant_id = $1'];
    const values: unknown[] = [TENANT_ID];

    if (this.asString(params?.imei)) {
      values.push(this.asString(params?.imei));
      filters.push(`imei = $${values.length}`);
    }
    if (this.asString(params?.connection_id)) {
      values.push(this.asString(params?.connection_id));
      filters.push(`connection_id = $${values.length}`);
    }
    if (this.asString(params?.direction)) {
      values.push(this.asString(params?.direction).toLowerCase());
      filters.push(`lower(direction) = $${values.length}`);
    }
    if (this.asString(params?.parse_status)) {
      values.push(this.asString(params?.parse_status).toLowerCase());
      filters.push(`lower(parse_status) = $${values.length}`);
    }
    if (this.asString(params?.ingest_status)) {
      values.push(this.asString(params?.ingest_status).toLowerCase());
      filters.push(`lower(ingest_status) = $${values.length}`);
    }
    if (this.asString(params?.keyword)) {
      values.push(`%${this.asString(params?.keyword)}%`);
      filters.push(
        `(coalesce(raw_frame_text, '') ilike $${values.length}
          or coalesce(request_snapshot_json::text, '') ilike $${values.length}
          or coalesce(ingest_error, '') ilike $${values.length})`
      );
    }

    const startAt = this.toIsoTimestamp(this.asString(params?.start_at));
    if (startAt) {
      values.push(startAt);
      filters.push(`created_at >= $${values.length}::timestamptz`);
    }

    const endAt = this.toIsoTimestamp(this.asString(params?.end_at));
    if (endAt) {
      values.push(endAt);
      filters.push(`created_at <= $${values.length}::timestamptz`);
    }

    const cursor = this.parseTcpAuditCursor(params?.cursor);
    if (cursor) {
      values.push(cursor.createdAt);
      const tsIndex = values.length;
      values.push(cursor.id);
      const idIndex = values.length;
      filters.push(
        `(created_at < $${tsIndex}::timestamptz
          or (created_at = $${tsIndex}::timestamptz and id < $${idIndex}::uuid))`
      );
    }

    const limit = Math.min(Math.max(Number(params?.limit ?? 50), 1), 100);
    values.push(limit + 1);

    const result = await this.db.query<TcpAuditLogRecord>(
      `
      select
        id::text as id,
        transport_type as "transportType",
        direction as direction,
        connection_id as "connectionId",
        remote_addr as "remoteAddr",
        remote_port as "remotePort",
        imei as imei,
        msg_type as "msgType",
        protocol_version as "protocolVersion",
        frame_size_bytes as "frameSizeBytes",
        parse_status as "parseStatus",
        ingest_status as "ingestStatus",
        ingest_error as "ingestError",
        raw_frame_text as "rawFrameText",
        request_snapshot_json as "requestSnapshot",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from device_tcp_audit_log
      where ${filters.join(' and ')}
      order by created_at desc, id desc
      limit $${values.length}
      `,
      values
    );

    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore
      ? this.buildTcpAuditCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
      : null;

    return {
      items: items.map((row) => ({
        id: row.id,
        transportType: row.transportType,
        direction: row.direction,
        connectionId: row.connectionId,
        remoteAddr: row.remoteAddr,
        remotePort: row.remotePort,
        imei: row.imei,
        msgType: row.msgType,
        protocolVersion: row.protocolVersion,
        frameSizeBytes: Number(row.frameSizeBytes ?? 0),
        parseStatus: row.parseStatus,
        ingestStatus: row.ingestStatus,
        ingestError: row.ingestError,
        rawFrameText: row.rawFrameText,
        requestSnapshot: this.asObject(row.requestSnapshot),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      })),
      limit,
      hasMore,
      nextCursor
    };
  }

  private async insertInteractionLogInClient(input: {
    id?: string | null;
    imei: string;
    deviceId?: string | null;
    connectionId?: string | null;
    protocolVersion?: string | null;
    direction: 'inbound' | 'outbound';
    msgId?: string | null;
    seqNo?: number | null;
    msgType: string;
    eventType?: string | null;
    sessionRef?: string | null;
    commandId?: string | null;
    deviceTs?: string | null;
    serverRxTs?: string | null;
    idempotencyKey: string;
    orderingKey: string;
    integrityOk?: boolean | null;
    clockDriftSec?: number | null;
    payload: Record<string, unknown>;
  }, client: PoolClient) {
    const logId = this.asString(input.id) || randomUUID();
    const artifacts = this.buildInteractionLogPayloadArtifacts(input.payload);
    const serverRxTs = this.toIsoTimestamp(input.serverRxTs ?? null) ?? new Date().toISOString();

    const dedup = await this.db.query<{ logId: string }>(
      `
      insert into device_message_log_v2_dedup (
        tenant_id, idempotency_key, log_id, server_rx_ts
      )
      values ($1, $2, $3::uuid, $4::timestamptz)
      on conflict (tenant_id, idempotency_key) do nothing
      returning log_id::text as "logId"
      `,
      [TENANT_ID, input.idempotencyKey, logId, serverRxTs],
      client
    );
    if (!dedup.rows[0]) {
      const existing = await this.db.query<{ logId: string }>(
        `
        select log_id::text as "logId"
        from device_message_log_v2_dedup
        where tenant_id = $1
          and idempotency_key = $2
        limit 1
        `,
        [TENANT_ID, input.idempotencyKey],
        client
      );
      return { duplicate: true, id: existing.rows[0]?.logId ?? null };
    }

    await this.db.query(
      `
      insert into device_message_log_v2 (
        id, tenant_id, imei, device_id, connection_id, protocol_version, direction,
        msg_id, seq_no, msg_type, event_type, session_ref, command_id, device_ts, server_rx_ts,
        idempotency_key, ordering_key, integrity_ok, clock_drift_sec,
        payload_json, payload_preview_json, payload_size_bytes, raw_body_text, raw_body_ref, storage_tier
      )
      values (
        $1::uuid, $2, $3, $4::uuid, $5, $6, $7,
        $8, $9, $10, $11, $12, $13::uuid, $14::timestamptz, $15::timestamptz,
        $16, $17, $18, $19,
        $20::jsonb, $21::jsonb, $22, $23, $24, $25
      )
      `,
      [
        logId,
        TENANT_ID,
        input.imei,
        input.deviceId ?? null,
        input.connectionId ?? null,
        this.asString(input.protocolVersion) || this.getProtocolName(),
        input.direction,
        this.asString(input.msgId) || null,
        input.seqNo ?? null,
        input.msgType,
        this.asString(input.eventType) || null,
        this.asString(input.sessionRef) || null,
        this.looksLikeUuid(input.commandId) ? input.commandId : null,
        this.toIsoTimestamp(input.deviceTs ?? null),
        serverRxTs,
        input.idempotencyKey,
        input.orderingKey,
        input.integrityOk !== false,
        input.clockDriftSec ?? null,
        JSON.stringify(artifacts.payloadJson),
        JSON.stringify(artifacts.payloadPreviewJson),
        artifacts.payloadSizeBytes,
        artifacts.rawBodyText,
        artifacts.rawBodyRef,
        artifacts.storageTier
      ],
      client
    );

    return {
      duplicate: false,
      id: logId
    };
  }

  private async insertMessageLog(event: DeviceRuntimeEvent, deviceId: string | null, client: PoolClient) {
    return this.insertInteractionLogInClient(
      {
        imei: event.imei,
        deviceId,
        connectionId: `http:${event.imei}`,
        protocolVersion: this.getProtocolName(),
        direction: 'inbound',
        msgId: event.msgId,
        seqNo: event.seqNo,
        msgType: event.msgType,
        eventType: event.eventType,
        sessionRef: event.sessionRef ?? null,
        commandId: null,
        deviceTs: this.toIsoTimestamp(event.deviceTs ?? null),
        serverRxTs: this.toIsoTimestamp(event.serverRxTs) ?? new Date().toISOString(),
        idempotencyKey: event.idempotencyKey,
        orderingKey: event.orderingKey,
        integrityOk: true,
        clockDriftSec: event.clockDriftSec ?? null,
        payload: {
          event_type: event.eventType,
          payload: event.payload,
          counters: event.counters
        }
      },
      client
    );
  }

  private async attachInteractionLogCommandId(
    logId: string | null | undefined,
    commandId: string | null | undefined,
    client: PoolClient
  ) {
    if (!this.looksLikeUuid(logId) || !this.looksLikeUuid(commandId)) {
      return { updated: false };
    }

    const result = await this.db.query<{ id: string }>(
      `
      update device_message_log_v2
      set command_id = $3::uuid
      where tenant_id = $1
        and id = $2::uuid
        and (command_id is null or command_id <> $3::uuid)
      returning id::text as id
      `,
      [TENANT_ID, logId, commandId],
      client
    );

    return {
      updated: Boolean(result.rows[0]),
      id: result.rows[0]?.id ?? null
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
    const extPatch = this.buildDeviceExtPatch(event);

    await this.db.query(
      `
      update device
      set protocol_version = $2,
          last_device_ts = coalesce($3::timestamptz, last_device_ts),
          last_heartbeat_at = $4::timestamptz,
          online_state = $5,
          connection_state = 'connected',
          runtime_state = $6,
          ext_json = coalesce(ext_json, '{}'::jsonb) || $7::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [
        device.id,
        envelope.protocolVersion,
        this.toIsoTimestamp(envelope.deviceTs),
        this.toIsoTimestamp(envelope.serverRxTs) ?? new Date().toISOString(),
        onlineState,
        runtimeState,
        JSON.stringify(extPatch)
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
            this.asString(input.protocolVersion) || this.getProtocolName(),
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
            this.asString(input.protocolVersion) || this.getProtocolName(),
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

      await this.runtimeIngestService.syncConnectionState(
        {
          tenantId: TENANT_ID,
          device,
          connectionState: 'connected',
          onlineState: 'online',
          lastEventAt: recoveredAt
        },
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
        const device = await this.findDeviceById(result.rows[0].deviceId, client);
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

        if (device) {
          await this.markPendingCardSwipeInterrupted(imei, client);
          await this.runtimeIngestService.syncConnectionState(
            {
              tenantId: TENANT_ID,
              device,
              connectionState: 'disconnected',
              lastEventAt: new Date().toISOString()
            },
            client
          );
        }
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

  private extractWorkflowState(envelope: DeviceEnvelope, event: DeviceRuntimeEvent) {
    const controllerState = this.asObject(event.payload.controller_state ?? event.payload.controllerState);
    return this.asString(
      controllerState.workflow_state ??
        controllerState.workflowState ??
        event.payload.workflow_state ??
        event.payload.workflowState ??
        event.payload.runtime_state ??
        event.payload.runtimeState ??
        event.payload.run_state ??
        event.payload.runState ??
        envelope.runState
    ).toLowerCase();
  }

  private async completePendingStartIfNeeded(
    session: ResolvedSession,
    event: DeviceRuntimeEvent,
    envelope: DeviceEnvelope,
    commandDispatch: ResolvedCommandDispatch | null,
    commandToken: string | null,
    client: PoolClient
  ) {
    if (session.status !== 'pending_start') {
      return null;
    }

    const commandCode =
      commandDispatch?.commandCode?.toLowerCase() ??
      this.asString(event.payload.command_code).toLowerCase();
    const workflowState = this.extractWorkflowState(envelope, event);
    const startedByAck = event.eventType === 'DEVICE_COMMAND_ACKED' && commandCode === 'start_session';
    const startedByRuntime =
      workflowState === 'running' ||
      workflowState === 'billing' ||
      workflowState === 'active';

    if (!startedByAck && !startedByRuntime) {
      return null;
    }

    const startedAt = this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs) ?? new Date().toISOString();
    const result = await this.db.query<ResolvedSession>(
      `
      update runtime_session
      set status = 'running',
          billing_started_at = coalesce(billing_started_at, $2::timestamptz),
          started_at = coalesce(started_at, $2::timestamptz),
          updated_at = now()
      where id = $1::uuid
        and status = 'pending_start'
      returning
        id,
        tenant_id as "tenantId",
        session_no as "sessionNo",
        session_ref as "sessionRef",
        status
      `,
      [session.id, startedAt],
      client
    );
    const started = result.rows[0] ?? null;
    if (!started) {
      return null;
    }

    await this.sessionStatusLogRepository.create(
      {
        tenantId: started.tenantId,
        sessionId: started.id,
        fromStatus: 'pending_start',
        toStatus: 'running',
        actionCode: 'start_session_completed',
        reasonCode: startedByAck ? 'START_COMMAND_ACKED' : 'DEVICE_RUNTIME_RUNNING',
        reasonText: startedByAck
          ? 'session entered running after device acknowledged start command'
          : 'session entered running after device reported running workflow state',
        source: 'system',
        snapshot: {
          gateway_event_type: event.eventType,
          gateway_msg_id: event.msgId,
          gateway_seq_no: event.seqNo,
          command_dispatch_id: commandDispatch?.id ?? null,
          command_token: commandToken,
          session_ref: started.sessionRef ?? event.sessionRef ?? null,
          workflow_state: workflowState || null,
          started_at: startedAt
        }
      },
      client
    );

    return started;
  }

  private async failPendingStartSession(
    session: ResolvedSession,
    client: PoolClient,
    input: {
      endedAt?: string | null;
      reasonCode: string;
      reasonText: string;
      gatewayEventType?: string | null;
      gatewayEventCode?: string | null;
      failureSource?: string | null;
      failureMessage?: string | null;
      snapshot?: Record<string, unknown>;
    }
  ) {
    if (session.status !== 'pending_start') {
      return null;
    }

    const endedAt = input.endedAt ?? new Date().toISOString();
    const result = await this.db.query<ResolvedSession>(
      `
      update runtime_session
      set status = 'ended',
          ended_at = coalesce(ended_at, $2::timestamptz),
          end_reason_code = $3,
          updated_at = now()
      where id = $1::uuid
        and status = 'pending_start'
      returning
        id,
        tenant_id as "tenantId",
        session_no as "sessionNo",
        session_ref as "sessionRef",
        status
      `,
      [session.id, endedAt, input.reasonCode],
      client
    );
    const ended = result.rows[0] ?? null;
    if (!ended) {
      return null;
    }

    await this.sessionStatusLogRepository.create(
      {
        tenantId: ended.tenantId,
        sessionId: ended.id,
        fromStatus: 'pending_start',
        toStatus: 'ended',
        actionCode: 'start_session_failed',
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        source: 'system',
        snapshot: {
          ended_at: endedAt,
          session_ref: ended.sessionRef ?? null,
          failure_source: input.failureSource ?? null,
          failure_message: input.failureMessage ?? null,
          gateway_event_type: input.gatewayEventType ?? null,
          gateway_event_code: input.gatewayEventCode ?? null,
          ...(input.snapshot ?? {})
        }
      },
      client
    );

    const settled = await this.orderSettlementService.cancelOrderBeforeStart(ended.id, client, {
      settledAt: endedAt,
      gatewayEventType: input.gatewayEventType ?? null,
      gatewayEventCode: input.gatewayEventCode ?? input.reasonCode,
      failureSource: input.failureSource ?? 'device_gateway',
      failureMessage: input.failureMessage ?? input.reasonText
    });

    if (settled) {
      await this.sessionStatusLogRepository.create(
        {
          tenantId: ended.tenantId,
          sessionId: ended.id,
          fromStatus: 'ended',
          toStatus: 'settled',
          actionCode: 'start_failure_refunded',
          reasonCode: input.reasonCode,
          reasonText: 'irrigation order closed with full refund or unlock after start failure',
          source: 'system',
          snapshot: {
            session_ref: ended.sessionRef ?? null,
            order_id: settled.orderId,
            amount: settled.amount,
            refunded_amount: settled.refundedAmount,
            settlement_status: settled.settlementStatus,
            payment_status: settled.paymentStatus
          }
        },
        client
      );
    }

    return { session: ended, order: settled };
  }

  private async failPendingStartFromNackIfNeeded(
    session: ResolvedSession,
    event: DeviceRuntimeEvent,
    commandDispatch: ResolvedCommandDispatch | null,
    commandToken: string | null,
    client: PoolClient
  ) {
    const commandCode =
      commandDispatch?.commandCode?.toLowerCase() ??
      this.asString(event.payload.command_code).toLowerCase();
    if (
      session.status !== 'pending_start' ||
      event.eventType !== 'DEVICE_COMMAND_NACKED' ||
      !['start_session', 'start_pump', 'open_valve'].includes(commandCode)
    ) {
      return null;
    }

    const reasonCode =
      this.asString(event.payload.reason_code) ||
      this.asString(event.payload.event_code) ||
      this.asString(event.payload.code) ||
      'start_command_nack';
    const reasonText =
      this.asString(event.payload.reason_text) ||
      this.asString(event.payload.reason) ||
      this.asString(event.payload.message) ||
      'device rejected the start command';

    return this.failPendingStartSession(session, client, {
      endedAt: this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs) ?? new Date().toISOString(),
      reasonCode,
      reasonText: `device rejected synchronous start workflow command: ${reasonText}`,
      gatewayEventType: event.eventType,
      gatewayEventCode: reasonCode,
      failureSource: 'device_nack',
      failureMessage: reasonText,
      snapshot: {
        gateway_msg_id: event.msgId,
        gateway_seq_no: event.seqNo,
        command_dispatch_id: commandDispatch?.id ?? null,
        command_token: commandToken
      }
    });
  }

  private async completePauseResumeIfNeeded(
    session: ResolvedSession,
    event: DeviceRuntimeEvent,
    envelope: DeviceEnvelope,
    commandDispatch: ResolvedCommandDispatch | null,
    commandToken: string | null,
    client: PoolClient
  ) {
    const workflowState = this.extractWorkflowState(envelope, event);
    const actionCode = this.resolveWorkflowActionCode(commandDispatch, event);
    const pausedByAck = event.eventType === 'DEVICE_COMMAND_ACKED' && actionCode === 'pause_session';
    const resumedByAck = event.eventType === 'DEVICE_COMMAND_ACKED' && actionCode === 'resume_session';
    const pausedByRuntime = workflowState === 'paused';
    const resumedByRuntime = workflowState === 'running' || workflowState === 'billing' || workflowState === 'active';

    if (
      (session.status === 'pausing' || session.status === 'running' || session.status === 'billing') &&
      (pausedByAck || pausedByRuntime)
    ) {
      const pausedAt = this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs) ?? new Date().toISOString();
      const pausedResult = await this.db.query<ResolvedSession>(
        `
        update runtime_session
        set status = 'paused',
            updated_at = now()
        where id = $1::uuid
          and status = any($2::text[])
        returning
          id,
          tenant_id as "tenantId",
          session_no as "sessionNo",
          session_ref as "sessionRef",
          status
        `,
        [session.id, ['pausing', 'running', 'billing']],
        client
      );
      const paused = pausedResult.rows[0] ?? null;
      if (!paused) {
        return null;
      }

      await this.orderSettlementService.markPauseConfirmed(paused.id, client, {
        pausedAt,
        reasonCode: pausedByAck ? 'PAUSE_COMMAND_ACKED' : 'DEVICE_RUNTIME_PAUSED',
        reasonText: pausedByAck
          ? 'session entered paused after device acknowledged pause command'
          : 'session entered paused after device reported paused workflow state',
        source: 'device_gateway'
      });

      await this.sessionStatusLogRepository.create(
        {
          tenantId: paused.tenantId,
          sessionId: paused.id,
          fromStatus: session.status,
          toStatus: 'paused',
          actionCode: pausedByAck ? 'pause_session_completed' : 'device_runtime_paused',
          reasonCode: pausedByAck ? 'PAUSE_COMMAND_ACKED' : 'DEVICE_RUNTIME_PAUSED',
          reasonText: pausedByAck
            ? 'session entered paused after device acknowledged pause command'
            : 'session entered paused after device reported paused workflow state',
          source: 'system',
          snapshot: {
            gateway_event_type: event.eventType,
            gateway_msg_id: event.msgId,
            gateway_seq_no: event.seqNo,
            command_dispatch_id: commandDispatch?.id ?? null,
            command_token: commandToken,
            session_ref: paused.sessionRef ?? event.sessionRef ?? null,
            workflow_state: workflowState || null,
            paused_at: pausedAt
          }
        },
        client
      );

      return paused;
    }

    if ((session.status === 'resuming' || session.status === 'paused') && (resumedByAck || resumedByRuntime)) {
      const resumedAt = this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs) ?? new Date().toISOString();
      const resumedResult = await this.db.query<ResolvedSession>(
        `
        update runtime_session
        set status = 'running',
            updated_at = now()
        where id = $1::uuid
          and status = any($2::text[])
        returning
          id,
          tenant_id as "tenantId",
          session_no as "sessionNo",
          session_ref as "sessionRef",
          status
        `,
        [session.id, ['resuming', 'paused']],
        client
      );
      const resumed = resumedResult.rows[0] ?? null;
      if (!resumed) {
        return null;
      }

      await this.orderSettlementService.markResumedFromPause(resumed.id, client, {
        resumedAt,
        reasonCode: resumedByAck ? 'RESUME_COMMAND_ACKED' : 'DEVICE_RUNTIME_RUNNING',
        reasonText: resumedByAck
          ? 'session resumed after device acknowledged resume command'
          : 'session resumed after device reported running workflow state',
        source: 'device_gateway'
      });

      await this.sessionStatusLogRepository.create(
        {
          tenantId: resumed.tenantId,
          sessionId: resumed.id,
          fromStatus: session.status,
          toStatus: 'running',
          actionCode: resumedByAck ? 'resume_session_completed' : 'device_runtime_resumed',
          reasonCode: resumedByAck ? 'RESUME_COMMAND_ACKED' : 'DEVICE_RUNTIME_RUNNING',
          reasonText: resumedByAck
            ? 'session resumed after device acknowledged resume command'
            : 'session resumed after device reported running workflow state',
          source: 'system',
          snapshot: {
            gateway_event_type: event.eventType,
            gateway_msg_id: event.msgId,
            gateway_seq_no: event.seqNo,
            command_dispatch_id: commandDispatch?.id ?? null,
            command_token: commandToken,
            session_ref: resumed.sessionRef ?? event.sessionRef ?? null,
            workflow_state: workflowState || null,
            resumed_at: resumedAt
          }
        },
        client
      );

      return resumed;
    }

    return null;
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

  private extractStopEventCode(event: DeviceRuntimeEvent) {
    return (
      this.asString(event.payload.event_code) ||
      this.asString(event.payload.stop_reason_code) ||
      this.asString(event.payload.reason_code) ||
      this.asString(event.payload.code) ||
      (event.eventType === 'DEVICE_RUNTIME_STOPPED' ? 'device_runtime_stopped' : '')
    ).toLowerCase();
  }

  private isAbnormalStopEvent(event: DeviceRuntimeEvent, stopEventCode: string) {
    if (this.asBoolean(event.payload.abnormal_stop)) {
      return true;
    }

    const powerState = this.asString(event.payload.power_state ?? event.payload.powerState).toLowerCase();
    if (powerState === 'off' || powerState === 'power_loss') {
      return true;
    }

    return (
      stopEventCode.includes('power') ||
      stopEventCode.includes('fault') ||
      stopEventCode.includes('alarm') ||
      stopEventCode.includes('abnormal') ||
      stopEventCode.includes('emergency')
    );
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
    const stopEventCode = this.extractStopEventCode(event);
    const normalStopClosure =
      session.status === 'stopping' &&
      (event.eventType === 'DEVICE_RUNTIME_STOPPED' ||
        (event.eventType === 'DEVICE_COMMAND_ACKED' && commandCode === 'stop_session'));
    const unexpectedRuntimeStop =
      event.eventType === 'DEVICE_RUNTIME_STOPPED' &&
      ['pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming'].includes(session.status);
    const shouldComplete = normalStopClosure || unexpectedRuntimeStop;

    if (!shouldComplete) {
      return null;
    }

    const endedAt = this.toIsoTimestamp(event.deviceTs ?? event.serverRxTs) ?? new Date().toISOString();
    const endReasonCode = stopEventCode || (event.eventType === 'DEVICE_RUNTIME_STOPPED' ? 'device_runtime_stopped' : 'stop_command_acked');
    const abnormalStop = this.isAbnormalStopEvent(event, endReasonCode);
    const completionSourceStatus = session.status;
    if (completionSourceStatus === 'pending_start') {
      return this.failPendingStartSession(session, client, {
        endedAt,
        reasonCode: endReasonCode,
        reasonText: 'session ended before start completed after device runtime stop event',
        gatewayEventType: event.eventType,
        gatewayEventCode: stopEventCode || endReasonCode,
        failureSource: 'device_runtime_stop',
        failureMessage: stopEventCode || endReasonCode,
        snapshot: {
          gateway_msg_id: event.msgId,
          gateway_seq_no: event.seqNo,
          command_dispatch_id: commandDispatch?.id ?? null,
          command_token: commandToken,
          abnormal_stop: abnormalStop
        }
      });
    }
    const allowedStatuses = unexpectedRuntimeStop
      ? ['pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming']
      : ['stopping'];
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
        and status = any($4::text[])
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
      [session.id, endedAt, endReasonCode, allowedStatuses],
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
        fromStatus: completionSourceStatus,
        toStatus: 'ended',
        actionCode: unexpectedRuntimeStop ? 'device_runtime_stop_completed' : 'stop_session_completed',
        reasonCode: endReasonCode,
        reasonText: unexpectedRuntimeStop
          ? 'session ended after device runtime stop event'
          : 'session stop completed after device acknowledgement',
        source: 'system',
        snapshot: {
          gateway_event_type: event.eventType,
          gateway_event_code: stopEventCode || null,
          gateway_msg_id: event.msgId,
          gateway_seq_no: event.seqNo,
          command_dispatch_id: commandDispatch?.id ?? null,
          command_token: commandToken,
          session_ref: stopped.sessionRef ?? event.sessionRef ?? null,
          ended_at: stopped.endedAt,
          abnormal_stop: abnormalStop
        }
      },
      client
    );

    const order = await this.orderRepository.findBySessionId(stopped.id, client);
    if (!order || order.status === 'settled') {
      return { stopped, order };
    }

    const finalized = await this.orderSettlementService.finalizeOrderAfterStop(stopped.id, client, {
      settledAt: stopped.endedAt,
      gatewayEventType: event.eventType,
      gatewayEventCode: stopEventCode || null,
      abnormalStop
    });

    await this.sessionStatusLogRepository.create(
      {
        tenantId: stopped.tenantId,
        sessionId: stopped.id,
        fromStatus: 'ended',
        toStatus: 'settled',
        actionCode: 'settle_success',
        reasonCode: 'ORDER_SETTLED',
        reasonText: unexpectedRuntimeStop
          ? 'irrigation order settled after unexpected device stop'
          : 'irrigation order settled after device acknowledgement',
        source: 'system',
        snapshot: {
          orderId: order.id,
          finalAmount: finalized?.amount ?? Number(order.amount ?? 0),
          refundedAmount: finalized?.refundedAmount ?? 0,
          gateway_event_type: event.eventType,
          gateway_event_code: stopEventCode || null,
          gateway_msg_id: event.msgId,
          session_ref: stopped.sessionRef ?? event.sessionRef ?? null,
          abnormal_stop: abnormalStop
        }
      },
      client
    );

    return { stopped, order: finalized ?? order };
  }

  private async updateCommandDispatch(
    commandDispatch: ResolvedCommandDispatch,
    event: DeviceRuntimeEvent,
    deviceCommand: ResolvedDeviceCommand | null,
    client: PoolClient
  ) {
    const isPositiveCommandClosure =
      event.eventType === 'DEVICE_COMMAND_ACKED' || event.eventType === 'DEVICE_QUERY_RESULT';
    const nackTransition =
      event.eventType === 'DEVICE_COMMAND_NACKED' && deviceCommand ? this.resolveNackTransition(deviceCommand, event) : null;
    const nextStatus =
      isPositiveCommandClosure
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
        isPositiveCommandClosure || event.eventType === 'DEVICE_COMMAND_NACKED',
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
    const isPositiveCommandClosure =
      event.eventType === 'DEVICE_COMMAND_ACKED' || event.eventType === 'DEVICE_QUERY_RESULT';
    const nackTransition = event.eventType === 'DEVICE_COMMAND_NACKED' ? this.resolveNackTransition(deviceCommand, event) : null;
    const nextStatus =
      isPositiveCommandClosure
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
        isPositiveCommandClosure,
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
        and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
      v: 1,
      t: 'HB',
      i: imei,
      m: this.asString(input.msg_id) || `bridge-heartbeat-${bridgeId}-${Date.now()}`,
      s: input.seq_no ?? Number(String(Date.now()).slice(-6)),
      r: this.asString(input.session_ref) || null,
      ts: this.toIsoTimestamp(this.asString(input.device_ts)) ?? new Date().toISOString(),
      p: {
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

    const commandIds: string[] = [];
    const commandTokens: string[] = [];

    for (const row of result.rows) {
      const synchronousStartCommand = this.isSynchronousStartCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const synchronousWorkflowControlCommand = this.isSynchronousWorkflowControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const nonReplayableRealtimeControlCommand = this.isNonReplayableRealtimeControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const nonRetryableControlCommand = synchronousStartCommand || synchronousWorkflowControlCommand;
      const nextStatus = nonRetryableControlCommand || nonReplayableRealtimeControlCommand ? 'dead_letter' : 'created';
      const transportPatch = nonRetryableControlCommand || nonReplayableRealtimeControlCommand
        ? {
            retry_count: this.getRetryCount(row.responsePayload),
            retryable: false,
            next_retry_at: null,
            retry_delay_seconds: null,
            last_transition: synchronousStartCommand
              ? 'sync_start_reconnect_closed'
              : synchronousWorkflowControlCommand
                ? 'sync_workflow_control_reconnect_closed'
                : 'realtime_control_reconnect_closed',
            dead_letter_reason: synchronousStartCommand
              ? 'sync_start_reconnect_blocked'
              : synchronousWorkflowControlCommand
                ? 'sync_workflow_control_reconnect_blocked'
                : 'realtime_control_reconnect_blocked',
            reconnect_detected_at: this.toIsoTimestamp(recovery.serverRxTs) ?? new Date().toISOString()
          }
        : this.buildConnectionRecoveryTransportPatch(recovery);

      await this.db.query(
        `
        update device_command
        set command_status = $2::varchar,
            sent_at = null,
            acked_at = null,
            failed_at = case when $2::varchar = 'dead_letter' then now() else null end,
            timeout_at = null,
            response_payload_json = $3::jsonb,
            updated_at = now()
        where id = $1::uuid
        `,
        [row.id, nextStatus, JSON.stringify(this.mergeTransportPayload(row.responsePayload, transportPatch))],
        client
      );

      await this.updateDispatchStatusByCommandToken(row.commandToken, nextStatus, transportPatch, client);

      if (synchronousStartCommand) {
        const session = await this.resolveSession(row.sessionRef ?? null, row.sessionId ?? null, client);
        if (session) {
          await this.failPendingStartSession(session, client, {
            endedAt: this.toIsoTimestamp(recovery.serverRxTs) ?? new Date().toISOString(),
            reasonCode: 'sync_start_reconnect_blocked',
            reasonText: 'synchronous start command was not reactivated after reconnect',
            gatewayEventType: recovery.eventType,
            gatewayEventCode: 'sync_start_reconnect_blocked',
            failureSource: 'connection_recovered',
            failureMessage: 'startup command remained closed after reconnect to prevent delayed auto-start',
            snapshot: {
              command_id: row.id,
              command_token: row.commandToken,
              command_code: row.commandCode,
              reconnect_msg_id: recovery.msgId
            }
          });
        }
        continue;
      }

      commandIds.push(row.id);
      commandTokens.push(row.commandToken);
    }

    return {
      reactivatedCount: commandIds.length,
      commandIds,
      commandTokens
    };
  }

  private async closeDisconnectedPendingControlCommands(
    imei: string,
    disconnectedAt: string,
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
        and dc.command_status in ('created', 'retry_pending')
      order by dc.created_at asc
      limit 100
      `,
      [TENANT_ID, imei],
      client
    );

    let deadLettered = 0;
    let startClosed = 0;
    let stopReviewQueued = 0;

    for (const row of result.rows) {
      const synchronousStartCommand = this.isSynchronousStartCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const synchronousWorkflowControlCommand = this.isSynchronousWorkflowControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const nonReplayableRealtimeControlCommand = this.isNonReplayableRealtimeControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const sessionStopCommand = this.isSessionStopCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });

      if (
        !synchronousStartCommand &&
        !synchronousWorkflowControlCommand &&
        !sessionStopCommand &&
        !nonReplayableRealtimeControlCommand
      ) {
        continue;
      }

      const transportPatch = {
        retry_count: this.getRetryCount(row.responsePayload),
        retryable: false,
        next_retry_at: null,
        retry_delay_seconds: null,
        last_transition: synchronousStartCommand
          ? 'sync_start_disconnect_closed'
          : synchronousWorkflowControlCommand
            ? 'sync_workflow_control_disconnect_closed'
            : sessionStopCommand
              ? 'session_stop_disconnect_review'
              : 'realtime_control_disconnect_closed',
        dead_letter_reason: synchronousStartCommand
          ? 'sync_start_device_disconnected'
          : synchronousWorkflowControlCommand
            ? 'sync_workflow_control_device_disconnected'
            : sessionStopCommand
              ? 'session_stop_device_disconnected'
              : 'realtime_control_device_disconnected',
        disconnected_at: disconnectedAt
      };

      await this.db.query(
        `
        update device_command
        set command_status = 'dead_letter',
            sent_at = null,
            acked_at = null,
            failed_at = coalesce(failed_at, now()),
            timeout_at = now(),
            response_payload_json = $2::jsonb,
            updated_at = now()
        where id = $1::uuid
        `,
        [row.id, JSON.stringify(this.mergeTransportPayload(row.responsePayload, transportPatch))],
        client
      );

      await this.updateDispatchStatusByCommandToken(row.commandToken, 'dead_letter', transportPatch, client);
      deadLettered += 1;

      if (synchronousStartCommand) {
        const session = await this.resolveSession(row.sessionRef ?? null, row.sessionId ?? null, client);
        if (session) {
          await this.failPendingStartSession(session, client, {
            endedAt: disconnectedAt,
            reasonCode: 'sync_start_device_disconnected',
            reasonText: 'device disconnected before synchronous start command could be completed',
            gatewayEventType: 'DEVICE_CONNECTION_INTERRUPTED',
            gatewayEventCode: 'sync_start_device_disconnected',
            failureSource: 'connection_sweep',
            failureMessage: 'device disconnected while synchronous start command was still pending',
            snapshot: {
              command_id: row.id,
              command_token: row.commandToken,
              command_code: row.commandCode
            }
          });
          startClosed += 1;
        }
        continue;
      }

      if (sessionStopCommand) {
        const session = await this.resolveSession(row.sessionRef ?? null, row.sessionId ?? null, client);
        if (session) {
          await this.orderSettlementService.markStopPendingReview(session.id, client, {
            reviewAt: disconnectedAt,
            reasonCode: 'device_disconnected_before_stop_dispatch',
            reasonText: 'stop command was closed because the device disconnected before acknowledgement',
            source: 'device_gateway_connection_sweep',
            commandId: row.id,
            commandToken: row.commandToken,
            commandCode: row.commandCode
          });
          stopReviewQueued += 1;
        }
      }
    }

    return {
      deadLettered,
      startClosed,
      stopReviewQueued
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
      const skipRuntimeIngest = this.isCardSwipeMetadataEvent(event);

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

      await this.attachInteractionLogCommandId(messageLog.id ?? null, matchedDeviceCommand?.id ?? null, client);

      if (session) {
        await this.touchRuntimeSession(session, event, envelope, commandDispatch, effectiveCommandToken, client);
      }

      const runtimeHealthStatus = await this.runtimeIngestService.syncHealthState(
        {
          tenantId: TENANT_ID,
          device,
          envelope,
          event
        },
        client
      );
      await this.syncCardSwipeOutcomeFromEvent(event, client);

      const dispatchUpdate = commandDispatch ? await this.updateCommandDispatch(commandDispatch, event, matchedDeviceCommand, client) : null;
      const deviceCommandUpdate =
        matchedDeviceCommand &&
        (
          event.eventType === 'DEVICE_COMMAND_ACKED' ||
          event.eventType === 'DEVICE_COMMAND_NACKED' ||
          event.eventType === 'DEVICE_QUERY_RESULT'
        )
          ? await this.updateDeviceCommand(matchedDeviceCommand, event, client)
          : null;

      if (!skipRuntimeIngest) {
        await this.runtimeIngestService.syncDerivedState(
          {
            tenantId: TENANT_ID,
            device,
            envelope,
            event,
            lastCommandId: matchedDeviceCommand?.id ?? null
          },
          client
        );
      }

      if (session) {
        const started = await this.completePendingStartIfNeeded(
          session,
          event,
          envelope,
          commandDispatch,
          effectiveCommandToken,
          client
        );
        if (started) {
          session = started;
        }

        const failedStart = await this.failPendingStartFromNackIfNeeded(
          session,
          event,
          commandDispatch,
          effectiveCommandToken,
          client
        );
        if (failedStart?.session) {
          session = failedStart.session;
        }

        await this.completePauseResumeIfNeeded(session, event, envelope, commandDispatch, effectiveCommandToken, client);
        await this.completeStoppingSessionIfNeeded(session, event, commandDispatch, effectiveCommandToken, client);
      }
      const alarm = event.eventType === 'DEVICE_ALARM_RAISED' ? await this.createAlarm(device.id, session?.id ?? null, event, client) : null;

      const orderProgress = session
        ? await this.orderSettlementService.syncProgressBySessionId(session.id, { client }).catch(() => null)
        : null;
      const cardSwipeBridge = this.isCardSwipeRequestedEvent(event)
        ? await this.bridgeCardSwipeRequestedEvent(event, client)
        : null;

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
        order_progress:
          orderProgress && !('skipped' in orderProgress)
            ? {
                order_id: orderProgress.orderId,
                amount: orderProgress.amount,
                credit_limit_reached: orderProgress.creditLimitReached
              }
            : null,
        card_swipe: cardSwipeBridge
          ? {
              handled: cardSwipeBridge.handled,
              accepted: cardSwipeBridge.accepted,
              action: cardSwipeBridge.action,
              session_id: cardSwipeBridge.sessionId,
              session_ref: cardSwipeBridge.sessionRef,
              order_id: cardSwipeBridge.orderId,
              awaiting_device_ack: cardSwipeBridge.awaitingDeviceAck,
              prompt_code: cardSwipeBridge.promptCode,
              error_code: cardSwipeBridge.errorCode,
              error_message: cardSwipeBridge.errorMessage,
              queued_command_count: cardSwipeBridge.queuedCommandCount
            }
          : null,
        auto_closed_work_orders: connectionRecovery.autoClosedOfflineWorkOrders.closedWorkOrderIds,
        recovery: {
          resolved_offline_alarm_ids: connectionRecovery.resolvedOfflineAlarmIds,
          reactivated_retry_command_ids: connectionRecovery.reactivatedRetryCommands.commandIds,
          reactivated_retry_command_tokens: connectionRecovery.reactivatedRetryCommands.commandTokens
        },
        runtime_health: runtimeHealthStatus
          ? {
              online_state: runtimeHealthStatus.onlineState,
              is_online: runtimeHealthStatus.isOnline,
              last_seen_at: runtimeHealthStatus.lastSeenAt,
              last_heartbeat_at: runtimeHealthStatus.lastHeartbeatAt,
              current_boot_session_id: runtimeHealthStatus.currentBootSessionId,
              health_flags: runtimeHealthStatus.healthFlags
            }
          : null
      };
    });
  }

  async getRuntimeShadow(imei: string) {
    return this.runtimeIngestService.getRuntimeShadowByImei(TENANT_ID, this.asString(imei));
  }

  async listRuntimeShadows(input: {
    project_id?: string;
    block_id?: string;
    imei?: string;
    limit?: number;
  }) {
    const projectId = this.asString(input.project_id);
    const blockId = this.asString(input.block_id);
    return this.runtimeIngestService.listRuntimeShadows({
      tenantId: TENANT_ID,
      projectId: this.looksLikeUuid(projectId) ? projectId : undefined,
      blockId: this.looksLikeUuid(blockId) ? blockId : undefined,
      imei: this.asString(input.imei) || undefined,
      limit: input.limit
    });
  }

  async listChannelLatest(input: {
    device_id?: string;
    imei?: string;
    project_id?: string;
    block_id?: string;
    metric_code?: string;
    limit?: number;
  }) {
    const deviceId = this.asString(input.device_id);
    const projectId = this.asString(input.project_id);
    const blockId = this.asString(input.block_id);
    return this.runtimeIngestService.listChannelLatest({
      tenantId: TENANT_ID,
      deviceId: this.looksLikeUuid(deviceId) ? deviceId : undefined,
      imei: this.asString(input.imei) || undefined,
      projectId: this.looksLikeUuid(projectId) ? projectId : undefined,
      blockId: this.looksLikeUuid(blockId) ? blockId : undefined,
      metricCode: this.asString(input.metric_code) || undefined,
      limit: input.limit
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
    const requestMsgId = this.asString(input.request_msg_id) || this.buildDefaultRequestMsgId(commandToken);
    const requestSeqNo = this.asNumber(input.request_seq_no) ?? this.buildDefaultRequestSeqNo(commandToken);

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
        requestMsgId,
        requestSeqNo,
        JSON.stringify(requestPayload)
      ],
      client
    );

    const queuedDeviceCommand = insertedCommand.rows[0];
    const outboundWireMessage = this.buildWireCommandEnvelope({
      commandToken: queuedDeviceCommand.commandToken,
      commandCode: queuedDeviceCommand.commandCode,
      imei: queuedDeviceCommand.imei,
      sessionRef: queuedDeviceCommand.sessionRef,
      requestMsgId,
      requestSeqNo,
      requestPayload
    });

    await this.insertInteractionLogInClient(
      {
        imei: queuedDeviceCommand.imei,
        deviceId: device.id,
        connectionId: null,
        protocolVersion: this.getProtocolName(),
        direction: 'outbound',
        msgId: requestMsgId,
        seqNo: requestSeqNo,
        msgType: outboundWireMessage?.t ? this.normalizeWireMsgType(outboundWireMessage.t) : normalizedCommandCode,
        eventType: 'PLATFORM_COMMAND_QUEUED',
        sessionRef,
        commandId: queuedDeviceCommand.id,
        deviceTs: null,
        serverRxTs: new Date().toISOString(),
        idempotencyKey: `outbound:${queuedDeviceCommand.commandToken}`,
        orderingKey: `outbound:${queuedDeviceCommand.imei}:${requestSeqNo}:${queuedDeviceCommand.commandToken}`,
        integrityOk: true,
        clockDriftSec: null,
        payload: {
          ...(outboundWireMessage ?? {})
        }
      },
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

  async getRealtimeDispatchCandidate(commandToken: string) {
    if (!this.looksLikeUuid(commandToken)) return null;

    const result = await this.db.query<QueuedDeviceCommand>(
      `
      select
        id,
        command_id::text as "commandToken",
        command_code as "commandCode",
        command_status as "commandStatus",
        target_device_id as "targetDeviceId",
        imei,
        session_id as "sessionId",
        session_ref as "sessionRef",
        request_msg_id as "requestMsgId",
        request_seq_no as "requestSeqNo",
        start_token as "startToken",
        sent_at as "sentAt",
        acked_at as "ackedAt",
        request_payload_json as "requestPayload"
      from device_command
      where tenant_id = $1
        and command_id = $2::uuid
      limit 1
      `,
      [TENANT_ID, commandToken]
    );

    const row = result.rows[0];
    if (!row) return null;
    if (!['created', 'retry_pending'].includes(row.commandStatus)) return null;

    const wireMessage = this.buildWireCommandEnvelope({
      commandToken: row.commandToken,
      commandCode: row.commandCode,
      imei: row.imei,
      sessionRef: row.sessionRef,
      requestMsgId: row.requestMsgId,
      requestSeqNo: row.requestSeqNo,
      requestPayload: row.requestPayload
    });
    if (!wireMessage) return null;

    return {
      id: row.id,
      commandToken: row.commandToken,
      commandCode: row.commandCode,
      commandStatus: row.commandStatus,
      targetDeviceId: row.targetDeviceId,
      imei: row.imei,
      sessionId: row.sessionId,
      sessionRef: row.sessionRef,
      requestMsgId: row.requestMsgId,
      requestSeqNo: row.requestSeqNo,
      startToken: row.startToken,
      requestPayload: row.requestPayload,
      wireMessage
    } satisfies RealtimeDispatchCandidate;
  }

  private async markQueuedCommandsSentInClient(
    rows: Array<{ id: string; commandToken: string; commandStatus: string }>,
    client: PoolClient
  ) {
    if (rows.length === 0) return;

    const commandIds = rows
      .filter((row) => row.commandStatus === 'created' || row.commandStatus === 'retry_pending')
      .map((row) => row.id);
    const commandTokens = rows.map((row) => row.commandToken);

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

  async markCommandSentRealtime(commandToken: string) {
    if (!this.looksLikeUuid(commandToken)) return { command_status: 'invalid' as const };

    return this.db.withTransaction(async (client) => {
      const result = await this.db.query<{ id: string; commandToken: string; commandStatus: string }>(
        `
        select
          id,
          command_id::text as "commandToken",
          command_status as "commandStatus"
        from device_command
        where tenant_id = $1
          and command_id = $2::uuid
        limit 1
        `,
        [TENANT_ID, commandToken],
        client
      );

      const row = result.rows[0];
      if (!row) return { command_status: 'missing' as const };
      await this.markQueuedCommandsSentInClient([row], client);
      return {
        command_status:
          row.commandStatus === 'created' || row.commandStatus === 'retry_pending'
            ? ('sent' as const)
            : (row.commandStatus as 'sent')
      };
    });
  }

  async recordRealtimeCommandSent(input: {
    commandId: string;
    targetDeviceId?: string | null;
    connectionId: string;
    imei: string;
    sessionRef?: string | null;
    requestMsgId?: string | null;
    requestSeqNo?: number | null;
    commandToken: string;
    commandCode: string;
    wireMessage: Record<string, unknown>;
  }) {
    return this.db.withTransaction(async (client) => {
      return this.insertInteractionLogInClient(
        {
          imei: input.imei,
          deviceId: input.targetDeviceId ?? null,
          connectionId: input.connectionId,
          protocolVersion: this.getProtocolName(),
          direction: 'outbound',
          msgId: input.requestMsgId ?? null,
          seqNo: input.requestSeqNo ?? null,
          msgType: this.normalizeWireMsgType(this.asString(input.wireMessage.t)) || input.commandCode,
          eventType: 'PLATFORM_COMMAND_SENT',
          sessionRef: input.sessionRef ?? null,
          commandId: input.commandId,
          deviceTs: null,
          serverRxTs: new Date().toISOString(),
          idempotencyKey: `outbound-sent:${input.commandToken}:${input.connectionId}`,
          orderingKey: `outbound-sent:${input.imei}:${input.requestSeqNo ?? 0}:${input.commandToken}`,
          integrityOk: true,
          clockDriftSec: null,
          payload: {
            ...input.wireMessage
          }
        },
        client
      );
    });
  }

  async dispatchQuery(input: DispatchQueryInput) {
    const queryCode = this.ensureSupportedQueryCode(input.query_code);
    return this.queueCommand({
      target_device_id: this.asString(input.target_device_id) || undefined,
      imei: this.asString(input.imei) || undefined,
      session_id: this.asString(input.session_id) || null,
      session_ref: this.asString(input.session_ref) || null,
      command_code: 'QUERY',
      request_payload: {
        ...this.asObject(input.payload),
        scope: this.resolveQueryScope(queryCode, input.scope),
        query_code: queryCode,
        module_code:
          queryCode === 'query_electric_meter' ? null : this.asString(input.module_code) || null,
        module_instance_code: null,
        channel_code: null,
        metric_codes: [],
      },
      source: this.asString(input.source) || 'ops_device_gateway.query',
    });
  }

  async dispatchExecuteAction(input: DispatchExecuteActionInput) {
    const actionCode = this.ensureSupportedActionCode(input.action_code);
    const requestPayload = this.asObject(input.payload);
    return this.queueCommand({
      target_device_id: this.asString(input.target_device_id) || undefined,
      imei: this.asString(input.imei) || undefined,
      session_id: this.asString(input.session_id) || null,
      session_ref: this.asString(input.session_ref) || null,
      order_id: this.asString(input.order_id) || null,
      start_token: this.asString(input.start_token) || null,
      command_code: 'EXECUTE_ACTION',
      request_payload: {
        ...requestPayload,
        scope: this.resolveActionScope(actionCode, input.scope),
        action_code: actionCode,
        module_code: this.resolveActionModuleCode(actionCode, input.module_code),
        module_instance_code: null,
        channel_code: null,
        target_ref: this.resolveActionTargetRef(actionCode, requestPayload, input.channel_code),
      },
      source: this.asString(input.source) || 'ops_device_gateway.execute',
    });
  }

  async dispatchSyncConfig(input: DispatchSyncConfigInput) {
    const configVersion = this.asNumber(input.config_version);
    if (configVersion === null) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'config_version is required');
    }

    return this.queueCommand({
      target_device_id: this.asString(input.target_device_id) || undefined,
      imei: this.asString(input.imei) || undefined,
      session_id: this.asString(input.session_id) || null,
      session_ref: this.asString(input.session_ref) || null,
      command_code: 'SYNC_CONFIG',
      request_payload: {
        ...this.asObject(input.payload),
        config_version: Math.trunc(configVersion),
        firmware_family: this.asString(input.firmware_family) || null,
        feature_modules: Array.isArray(input.feature_modules)
          ? input.feature_modules.map((item) => this.asString(item)).filter((item) => Boolean(item))
          : [],
        channel_bindings: Array.isArray(input.channel_bindings) ? input.channel_bindings : [],
        runtime_rules: this.asObject(input.runtime_rules),
        resource_inventory: this.asObject(input.resource_inventory),
      },
      source: this.asString(input.source) || 'ops_device_gateway.sync_config',
    });
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
          dc.request_msg_id as "requestMsgId",
          dc.request_seq_no as "requestSeqNo",
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
        await this.markQueuedCommandsSentInClient(result.rows, client);
      }

      return {
        items: result.rows.map((row) => {
          const wireMessage = this.buildWireCommandEnvelope({
            commandToken: row.commandToken,
            commandCode: row.commandCode,
            imei: row.imei,
            sessionRef: row.sessionRef,
            requestMsgId: row.requestMsgId,
            requestSeqNo: row.requestSeqNo,
            requestPayload: row.requestPayload
          });
          return {
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
            request_msg_id: row.requestMsgId,
            request_seq_no: row.requestSeqNo,
            start_token: row.startToken,
            sent_at: markSent && (row.commandStatus === 'created' || row.commandStatus === 'retry_pending')
              ? new Date().toISOString()
              : row.sentAt,
            acked_at: row.ackedAt,
            device_name: row.deviceName,
            request_payload: row.requestPayload,
            wire_message: wireMessage
          };
        }),
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

  async listInteractionLogs(params?: {
    device_id?: string;
    imei?: string;
    direction?: string;
    msg_type?: string;
    event_type?: string;
    session_ref?: string;
    command_id?: string;
    keyword?: string;
    start_at?: string;
    end_at?: string;
    cursor?: string;
    limit?: number;
  }) {
    const filters: string[] = ['log_scope.tenant_id = $1'];
    const values: unknown[] = [TENANT_ID];

    const normalizedDeviceId = this.asString(params?.device_id);
    const normalizedImei = this.asString(params?.imei);
    if (normalizedDeviceId && normalizedImei) {
      values.push(normalizedDeviceId);
      const deviceIndex = values.length;
      values.push(normalizedImei);
      const imeiIndex = values.length;
      filters.push(`(log_scope.device_id = $${deviceIndex} or log_scope.imei = $${imeiIndex})`);
    } else if (normalizedDeviceId) {
      values.push(normalizedDeviceId);
      filters.push(`log_scope.device_id = $${values.length}`);
    } else if (normalizedImei) {
      values.push(normalizedImei);
      filters.push(`log_scope.imei = $${values.length}`);
    }
    if (this.asString(params?.direction)) {
      values.push(this.asString(params?.direction).toLowerCase());
      filters.push(`lower(log_scope.direction) = $${values.length}`);
    }
    if (this.asString(params?.msg_type)) {
      values.push(this.asString(params?.msg_type).toUpperCase());
      filters.push(`upper(log_scope.msg_type) = $${values.length}`);
    }
    if (this.asString(params?.event_type)) {
      values.push(this.asString(params?.event_type));
      filters.push(`log_scope.event_type = $${values.length}`);
    }
    if (this.asString(params?.session_ref)) {
      values.push(this.asString(params?.session_ref));
      filters.push(`log_scope.session_ref = $${values.length}`);
    }
    if (this.asString(params?.command_id)) {
      values.push(this.asString(params?.command_id));
      filters.push(`log_scope.command_id = $${values.length}`);
    }
    if (this.asString(params?.keyword)) {
      values.push(`%${this.asString(params?.keyword)}%`);
      filters.push(
        `(coalesce(log_scope.raw_body_text, log_scope.payload_json::text, '') ilike $${values.length}
          or coalesce(log_scope.payload_preview_json::text, '') ilike $${values.length})`
      );
    }

    const startAt = this.toIsoTimestamp(this.asString(params?.start_at));
    if (startAt) {
      values.push(startAt);
      filters.push(`log_scope.server_rx_ts >= $${values.length}::timestamptz`);
    }

    const endAt = this.toIsoTimestamp(this.asString(params?.end_at));
    if (endAt) {
      values.push(endAt);
      filters.push(`log_scope.server_rx_ts <= $${values.length}::timestamptz`);
    }

    const cursor = this.parseInteractionLogCursor(params?.cursor);
    if (cursor) {
      values.push(cursor.serverRxTs);
      const tsIndex = values.length;
      values.push(cursor.id);
      const idIndex = values.length;
      filters.push(
        `(log_scope.server_rx_ts < $${tsIndex}::timestamptz
          or (log_scope.server_rx_ts = $${tsIndex}::timestamptz and log_scope.id < $${idIndex}))`
      );
    }

    const limit = Math.min(Math.max(Number(params?.limit ?? 50), 1), 100);
    values.push(limit + 1);

    const result = await this.db.query<DeviceInteractionLogRecord>(
      `
      with log_scope as (
        select
          'v2'::text as source,
          dml.id::text as id,
          dml.tenant_id as tenant_id,
          dml.device_id::text as device_id,
          dml.imei,
          d.device_code as device_code,
          d.device_name as device_name,
          dml.connection_id as connection_id,
          dml.protocol_version as protocol_version,
          dml.direction,
          dml.msg_id as msg_id,
          dml.seq_no as seq_no,
          dml.msg_type as msg_type,
          dml.event_type as event_type,
          dml.session_ref as session_ref,
          dml.command_id::text as command_id,
          dc.command_id::text as command_token,
          dc.command_code as command_code,
          dc.command_status as command_status,
          dml.device_ts as device_ts,
          dml.server_rx_ts as server_rx_ts,
          dml.integrity_ok as integrity_ok,
          dml.payload_size_bytes as payload_size_bytes,
          dml.payload_preview_json as payload_preview_json,
          dml.payload_json as payload_json,
          dml.raw_body_text as raw_body_text,
          dml.raw_body_ref as raw_body_ref,
          dml.storage_tier as storage_tier
        from device_message_log_v2 dml
        left join device d on d.id = dml.device_id
        left join device_command dc on dc.id = dml.command_id
        where dml.tenant_id = $1

        union all

        select
          'legacy'::text as source,
          dml.id::text as id,
          dml.tenant_id as tenant_id,
          dml.device_id::text as device_id,
          dml.imei,
          d.device_code as device_code,
          d.device_name as device_name,
          dml.connection_id as connection_id,
          dml.protocol_version as protocol_version,
          dml.direction,
          dml.msg_id as msg_id,
          dml.seq_no as seq_no,
          dml.msg_type as msg_type,
          dml.payload_json->>'event_type' as event_type,
          dml.session_ref as session_ref,
          dml.command_id::text as command_id,
          dc.command_id::text as command_token,
          dc.command_code as command_code,
          dc.command_status as command_status,
          dml.device_ts as device_ts,
          dml.server_rx_ts as server_rx_ts,
          dml.integrity_ok as integrity_ok,
          greatest(octet_length(dml.payload_json::text), 0) as payload_size_bytes,
          coalesce(
            case when jsonb_typeof(dml.payload_json->'payload') = 'object' then dml.payload_json->'payload' end,
            dml.payload_json
          ) as payload_preview_json,
          dml.payload_json as payload_json,
          null::text as raw_body_text,
          null::varchar(512) as raw_body_ref,
          'legacy_hot'::varchar(16) as storage_tier
        from device_message_log dml
        left join device d on d.id = dml.device_id
        left join device_command dc on dc.id = dml.command_id
        where dml.tenant_id = $1
      )
      select
        log_scope.source as source,
        log_scope.id as id,
        log_scope.tenant_id as "tenantId",
        log_scope.device_id as "deviceId",
        log_scope.imei as imei,
        log_scope.device_code as "deviceCode",
        log_scope.device_name as "deviceName",
        log_scope.connection_id as "connectionId",
        log_scope.protocol_version as "protocolVersion",
        log_scope.direction as direction,
        log_scope.msg_id as "msgId",
        log_scope.seq_no as "seqNo",
        log_scope.msg_type as "msgType",
        log_scope.event_type as "eventType",
        log_scope.session_ref as "sessionRef",
        log_scope.command_id as "commandId",
        log_scope.command_token as "commandToken",
        log_scope.command_code as "commandCode",
        log_scope.command_status as "commandStatus",
        log_scope.device_ts::text as "deviceTs",
        log_scope.server_rx_ts::text as "serverRxTs",
        log_scope.integrity_ok as "integrityOk",
        log_scope.payload_size_bytes as "payloadSizeBytes",
        log_scope.payload_preview_json as "payloadPreview",
        log_scope.payload_json as payload,
        log_scope.raw_body_text as "rawBodyText",
        log_scope.raw_body_ref as "rawBodyRef",
        log_scope.storage_tier as "storageTier"
      from log_scope
      where ${filters.join(' and ')}
      order by log_scope.server_rx_ts desc, log_scope.id desc
      limit $${values.length}
      `,
      values
    );

    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore
      ? this.buildInteractionLogCursor(items[items.length - 1].serverRxTs, items[items.length - 1].id)
      : null;

    return {
      items: items.map((row) => ({
        source: row.source,
        id: row.id,
        tenantId: row.tenantId,
        deviceId: row.deviceId,
        imei: row.imei,
        deviceCode: row.deviceCode,
        deviceName: row.deviceName,
        connectionId: row.connectionId,
        protocolVersion: row.protocolVersion,
        direction: row.direction,
        msgId: row.msgId,
        seqNo: row.seqNo,
        msgType: row.msgType,
        eventType: row.eventType,
        sessionRef: row.sessionRef,
        commandId: row.commandId,
        commandToken: row.commandToken,
        commandCode: row.commandCode,
        commandStatus: row.commandStatus,
        deviceTs: row.deviceTs,
        serverRxTs: row.serverRxTs,
        integrityOk: row.integrityOk,
        payloadSizeBytes: Number(row.payloadSizeBytes ?? 0),
        payloadPreview: this.asObject(row.payloadPreview),
        payload: this.asObject(row.payload),
        rawBodyRef: row.rawBodyRef,
        storageTier: row.storageTier,
        hasRawBody: Boolean(row.rawBodyText || row.rawBodyRef)
      })),
      limit,
      hasMore,
      nextCursor
    };
  }

  async getInteractionLogRaw(logId: string) {
    const normalizedLogId = this.asString(logId);
    if (!this.looksLikeUuid(normalizedLogId)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'logId must be a uuid');
    }

    const result = await this.db.query<{
      source: 'v2' | 'legacy';
      id: string;
      msgType: string;
      rawBodyText: string | null;
      payload: Record<string, unknown>;
    }>(
      `
      with log_scope as (
        select
          'v2'::text as source,
          dml.id::text as id,
          dml.msg_type as msg_type,
          dml.raw_body_text as raw_body_text,
          dml.payload_json as payload_json
        from device_message_log_v2 dml
        where dml.tenant_id = $1
          and dml.id = $2::uuid

        union all

        select
          'legacy'::text as source,
          dml.id::text as id,
          dml.msg_type as msg_type,
          null::text as raw_body_text,
          dml.payload_json as payload_json
        from device_message_log dml
        where dml.tenant_id = $1
          and dml.id = $2::uuid
      )
      select
        source as source,
        id as id,
        msg_type as "msgType",
        raw_body_text as "rawBodyText",
        payload_json as payload
      from log_scope
      limit 1
      `,
      [TENANT_ID, normalizedLogId]
    );

    const row = result.rows[0] ?? null;
    if (!row) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Interaction log not found', 404, { logId });
    }

    const body = row.rawBodyText || JSON.stringify(row.payload ?? {}, null, 2);
    const extension = row.rawBodyText ? 'txt' : 'json';
    return {
      file_name: `device-interaction-log-${normalizedLogId}.${extension}`,
      content_type: row.rawBodyText ? 'text/plain' : 'application/json',
      body
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
          and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
       and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
      const runtimeHealthSweep = await this.runtimeIngestService.sweepHealthState(TENANT_ID, client);
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
      let disconnectedCommandDeadLetterCount = 0;
      let disconnectedStartClosedCount = 0;
      let disconnectedStopReviewCount = 0;

      for (const item of devices.rows) {
        const device: ResolvedDevice = {
          id: item.id,
          imei: item.imei,
          deviceCode: item.deviceCode,
          deviceName: item.deviceName,
          onlineState: 'offline',
          runtimeState: null,
          projectId: null,
          blockId: null,
          sourceNodeCode: null
        };
        const disconnectedAt = new Date().toISOString();
        const disconnectedCommandRecovery = await this.closeDisconnectedPendingControlCommands(item.imei, disconnectedAt, client);
        disconnectedCommandDeadLetterCount += disconnectedCommandRecovery.deadLettered;
        disconnectedStartClosedCount += disconnectedCommandRecovery.startClosed;
        disconnectedStopReviewCount += disconnectedCommandRecovery.stopReviewQueued;
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
        runtime_health_sweep: runtimeHealthSweep,
        swept_device_count: devices.rows.length,
        swept_imeis: devices.rows.map((item) => item.imei),
        created_alarm_count: createdAlarmCount,
        refreshed_alarm_count: refreshedAlarmCount,
        impacted_session_count: impactedSessionCount,
        created_work_order_count: createdWorkOrderCount,
        reused_work_order_count: reusedWorkOrderCount,
        auto_assigned_work_order_count: autoAssignedWorkOrderCount,
        disconnected_command_dead_letter_count: disconnectedCommandDeadLetterCount,
        disconnected_start_closed_count: disconnectedStartClosedCount,
        disconnected_stop_review_count: disconnectedStopReviewCount
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
        const synchronousStartCommand = this.isSynchronousStartCommand({
          commandCode: row.commandCode,
          requestPayload: row.requestPayload
        });
      const synchronousWorkflowControlCommand = this.isSynchronousWorkflowControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const nonReplayableRealtimeControlCommand = this.isNonReplayableRealtimeControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const sessionStopCommand = this.isSessionStopCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const nonRetryableControlCommand =
        synchronousStartCommand || synchronousWorkflowControlCommand || nonReplayableRealtimeControlCommand;
      const retryCount = this.getRetryCount(row.responsePayload);
        const nextRetryCount = retryCount + 1;
        const canRetry = !nonRetryableControlCommand && nextRetryCount <= policy.retry_limit;
        const nextRetryAt = canRetry ? this.computeNextRetryAt(nextRetryCount) : null;
        const nextStatus = canRetry ? 'retry_pending' : 'dead_letter';
        const transportPatch = {
          retry_count: nextRetryCount,
          retry_delay_seconds: canRetry ? this.computeRetryDelaySeconds(nextRetryCount) : null,
          next_retry_at: nextRetryAt,
          retryable: !nonRetryableControlCommand,
          last_transition: synchronousStartCommand
            ? 'sync_start_timeout_closed'
            : synchronousWorkflowControlCommand
              ? 'sync_workflow_control_timeout_closed'
            : nonReplayableRealtimeControlCommand
              ? 'realtime_control_timeout_closed'
            : canRetry
              ? 'timeout_requeue'
              : 'dead_letter_timeout',
          last_timeout_at: new Date().toISOString(),
          dead_letter_reason: canRetry
            ? null
            : synchronousStartCommand
              ? 'sync_start_ack_timeout'
              : synchronousWorkflowControlCommand
                ? 'sync_workflow_control_ack_timeout'
              : nonReplayableRealtimeControlCommand
                ? 'realtime_control_ack_timeout'
              : 'ack_timeout_exceeded'
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

        if (nextStatus === 'dead_letter' && synchronousStartCommand) {
          const session = await this.resolveSession(row.sessionRef ?? null, row.sessionId ?? null, client);
          if (session) {
            await this.failPendingStartSession(session, client, {
              endedAt: new Date().toISOString(),
              reasonCode: 'sync_start_ack_timeout',
              reasonText: 'synchronous start command timed out before device acknowledgement and was closed immediately',
              gatewayEventType: 'COMMAND_TIMEOUT',
              gatewayEventCode: 'sync_start_ack_timeout',
              failureSource: 'command_timeout',
              failureMessage: 'synchronous start command timed out before device acknowledgement',
              snapshot: {
                command_id: row.id,
                command_token: row.commandToken,
                command_code: row.commandCode,
                command_status: nextStatus,
                timeout_at: new Date().toISOString()
              }
          });
        }
        }

        if (nextStatus === 'dead_letter' && sessionStopCommand) {
          const session = await this.resolveSession(row.sessionRef ?? null, row.sessionId ?? null, client);
          if (session) {
            await this.orderSettlementService.markStopPendingReview(session.id, client, {
              reviewAt: new Date().toISOString(),
              reasonCode: 'ack_timeout_exceeded',
              reasonText: 'stop command timed out before device acknowledgement and the order is waiting for manual review',
              source: 'device_gateway_timeout_sweep',
              commandId: row.id,
              commandToken: row.commandToken,
              commandCode: row.commandCode
            });
          }
        }

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

  async listCommands(params?: {
    imei?: string;
    target_device_id?: string;
    session_ref?: string;
    command_status?: string;
    command_code?: string;
    limit?: number;
  }) {
    const filters: string[] = ['dc.tenant_id = $1'];
    const values: unknown[] = [TENANT_ID];

    if (this.asString(params?.imei)) {
      values.push(this.asString(params?.imei));
      filters.push(`dc.imei = $${values.length}`);
    }
    if (this.asString(params?.target_device_id)) {
      values.push(this.asString(params?.target_device_id));
      filters.push(`dc.target_device_id = $${values.length}::uuid`);
    }
    if (this.asString(params?.session_ref)) {
      values.push(this.asString(params?.session_ref));
      filters.push(`dc.session_ref = $${values.length}`);
    }
    if (this.asString(params?.command_status)) {
      values.push(this.asString(params?.command_status));
      filters.push(`dc.command_status = $${values.length}`);
    }
    if (this.asString(params?.command_code)) {
      values.push(this.asString(params?.command_code).toUpperCase());
      filters.push(`dc.command_code = $${values.length}`);
    }

    const limit = Math.min(Math.max(Number(params?.limit ?? 50), 1), 200);
    values.push(limit);

    const result = await this.db.query<DeviceGatewayCommandRecord>(
      `
      select
        dc.id,
        dc.command_id::text as "commandToken",
        dc.command_code as "commandCode",
        dc.command_status as "commandStatus",
        dc.imei,
        dc.target_device_id::text as "targetDeviceId",
        dc.session_id::text as "sessionId",
        dc.session_ref as "sessionRef",
        dc.request_msg_id as "requestMsgId",
        dc.request_seq_no as "requestSeqNo",
        dc.ack_msg_id as "ackMsgId",
        dc.ack_seq_no as "ackSeqNo",
        dc.sent_at as "sentAt",
        dc.acked_at as "ackedAt",
        dc.failed_at as "failedAt",
        dc.timeout_at as "timeoutAt",
        dc.created_at as "createdAt",
        dc.updated_at as "updatedAt",
        dc.request_payload_json as "requestPayload",
        dc.response_payload_json as "responsePayload",
        d.device_code as "deviceCode",
        d.device_name as "deviceName"
      from device_command dc
      left join device d on d.id = dc.target_device_id
      where ${filters.join(' and ')}
      order by dc.created_at desc
      limit $${values.length}
      `,
      values
    );

    return result.rows.map((row) => this.serializeCommandRecord(row));
  }

  async getCommand(commandId: string) {
    if (!this.looksLikeUuid(commandId)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'commandId must be a uuid');
    }

    const result = await this.db.query<DeviceGatewayCommandRecord>(
      `
      select
        dc.id,
        dc.command_id::text as "commandToken",
        dc.command_code as "commandCode",
        dc.command_status as "commandStatus",
        dc.imei,
        dc.target_device_id::text as "targetDeviceId",
        dc.session_id::text as "sessionId",
        dc.session_ref as "sessionRef",
        dc.request_msg_id as "requestMsgId",
        dc.request_seq_no as "requestSeqNo",
        dc.ack_msg_id as "ackMsgId",
        dc.ack_seq_no as "ackSeqNo",
        dc.sent_at as "sentAt",
        dc.acked_at as "ackedAt",
        dc.failed_at as "failedAt",
        dc.timeout_at as "timeoutAt",
        dc.created_at as "createdAt",
        dc.updated_at as "updatedAt",
        dc.request_payload_json as "requestPayload",
        dc.response_payload_json as "responsePayload",
        d.device_code as "deviceCode",
        d.device_name as "deviceName"
      from device_command dc
      left join device d on d.id = dc.target_device_id
      where dc.tenant_id = $1 and dc.id = $2::uuid
      limit 1
      `,
      [TENANT_ID, commandId]
    );

    const row = result.rows[0] ?? null;
    if (!row) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Device command not found', 404, { commandId });
    }
    return this.serializeCommandRecord(row);
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

      const synchronousStartCommand = this.isSynchronousStartCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const synchronousWorkflowControlCommand = this.isSynchronousWorkflowControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      const nonReplayableRealtimeControlCommand = this.isNonReplayableRealtimeControlCommand({
        commandCode: row.commandCode,
        requestPayload: row.requestPayload
      });
      if (synchronousStartCommand || synchronousWorkflowControlCommand || nonReplayableRealtimeControlCommand) {
        throw new AppException(
          ErrorCodes.FORBIDDEN,
          synchronousStartCommand
            ? 'Synchronous start commands cannot be requeued manually because delayed resend may auto-start the pump later'
            : synchronousWorkflowControlCommand
              ? 'Synchronous pause/resume commands cannot be requeued manually because delayed resend may pause or resume the session later'
              : 'Realtime control commands cannot be requeued manually because delayed resend may change on-site device state later',
          400,
          {
            commandId,
            commandCode: row.commandCode,
            commandStatus: row.commandStatus
          }
        );
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
