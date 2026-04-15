import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import {
  AvailableAction,
  BlockingReason,
  RuntimeDecisionContract,
  createAvailableAction,
  createBlockingReason
} from '../../common/contracts/runtime-decision';
import { resolveRoleControlRoute } from '../../common/device-control-routing';
import {
  isActiveRuntimeWorkflowState,
  normalizeRuntimeWorkflowState,
} from '../../common/runtime-workflow-state';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { DeviceGatewayService } from '../device-gateway/device-gateway.service';
import { TcpJsonV1Server } from '../device-gateway/tcp-json-v1.server';
import { deriveFormalOrderLifecycleStage } from '../order/order-lifecycle';
import { OrderRepository } from '../order/order.repository';
import { OrderSettlementService } from '../order/order-settlement.service';
import { EffectivePolicyResolver, FIXED_PRIORITY_CHAIN } from '../policy/effective-policy.resolver';
import { TopologyService } from '../topology/topology.service';
import { FarmerFundRepository } from '../farmer-fund/farmer-fund.repository';
import { RuntimeIngestRepository } from '../runtime-ingest/runtime-ingest.repository';
import { RuntimeRepository } from './runtime.repository';
import { SessionStatusLogRepository } from './session-status-log.repository';

type CreateSessionOptions = {
  orderChannel?: string | null;
  fundingMode?: string | null;
  paymentMode?: string | null;
  paymentStatus?: string | null;
  targetDeviceId?: string | null;
  targetImei?: string | null;
  targetDeviceRole?: string | null;
  prepaidAmount?: number | null;
  lockedAmount?: number | null;
  sourcePaymentIntentId?: string | null;
  startedVia?: string | null;
  checkoutSnapshot?: Record<string, unknown> | null;
};

@Injectable()
export class RuntimeDecisionService {
  constructor(
    private readonly topologyService: TopologyService,
    private readonly effectivePolicyResolver: EffectivePolicyResolver,
    private readonly runtimeRepository: RuntimeRepository,
    private readonly farmerFundRepository: FarmerFundRepository
  ) {}

  async createStartDecision(
    input: { targetType: 'valve' | 'well' | 'pump' | 'session'; targetId: string; sceneCode?: string; relationId?: string | null },
    options?: { cardToken?: string | null }
  ): Promise<RuntimeDecisionContract> {
    const normalizedTargetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
    if (!normalizedTargetId) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '启动目标缺失，无法创建运行决策', 400, {
        targetType: input.targetType,
        relationId: input.relationId ?? null,
        sceneCode: input.sceneCode ?? 'farmer_scan_start'
      });
    }

    const runtimeUser = await this.getRuntimeUser(options?.cardToken);
    const evaluated = await this.evaluateStartEligibility(
      {
        targetType: input.targetType,
        targetId: normalizedTargetId,
        sceneCode: input.sceneCode ?? 'farmer_scan_start',
        relationId: input.relationId ?? null
      },
      runtimeUser.id,
      runtimeUser.tenantId,
      options?.cardToken,
      undefined
    );

    const decisionId = await this.runtimeRepository.createDecision({
      tenantId: runtimeUser.tenantId,
      userId: runtimeUser.id,
      sceneCode: evaluated.sceneCode,
      targetType: evaluated.targetType,
      targetId: evaluated.targetId,
      result: evaluated.result,
      blockingReasons: evaluated.blockingReasons,
      availableActions: evaluated.availableActions,
      effectiveRuleSnapshot: evaluated.effectiveRuleSnapshot,
      pricePreview: evaluated.pricePreview
    });

    return {
      decisionId,
      result: evaluated.result,
      blockingReasons: evaluated.blockingReasons,
      availableActions: evaluated.availableActions,
      effectiveRuleSource: {
        policyId: (evaluated.effectiveRuleSnapshot as Record<string, any>).sourceIds?.policyId,
        relationId: (evaluated.effectiveRuleSnapshot as Record<string, any>).sourceIds?.relationId,
        priorityChain: [...FIXED_PRIORITY_CHAIN]
      },
      pricePreview: evaluated.pricePreview as RuntimeDecisionContract['pricePreview']
    };
  }

  private estimateMinChargeAmount(mode: string, unitPrice: number, minChargeAmount: number) {
    if (mode === 'flat') {
      return Math.max(minChargeAmount, unitPrice);
    }
    if (mode === 'free') {
      return 0;
    }
    return Math.max(minChargeAmount, unitPrice > 0 ? unitPrice : minChargeAmount);
  }

  private requiresElectricMeterReadiness(mode: string) {
    return mode === 'electric' || mode === 'water_electric';
  }

  private buildBillingModeReadinessLabel(mode: string) {
    return mode === 'water_electric' ? '当前计费模式包含电量计费' : '按电量计费';
  }

  private buildElectricMeterBlockingReason(
    mode: string,
    metering: {
      blockId: string | null;
      blockName: string | null;
      meteringPointId: string | null;
      meteringPointCode: string | null;
      primaryMeterDeviceId: string | null;
      primaryMeterDeviceName: string | null;
      primaryMeterLifecycleState: string | null;
      primaryMeterOnlineState: string | null;
    } | null,
    wellId: string
  ) {
    const readinessLabel = this.buildBillingModeReadinessLabel(mode);
    if (!metering?.blockId) {
      return createBlockingReason(
        ErrorCodes.RELATION_NOT_CONFIGURED,
        `${readinessLabel}时井位未绑定区块，无法校验主电表`,
        'metering',
        {
          scope: 'billing_meter',
          well_id: wellId,
          billing_mode: mode
        }
      );
    }

    if (!metering.meteringPointId) {
      return createBlockingReason(
        ErrorCodes.RELATION_NOT_CONFIGURED,
        `${readinessLabel}时当前区块未配置可用电力计量点`,
        'metering',
        {
          scope: 'billing_meter',
          well_id: wellId,
          block_id: metering.blockId,
          block_name: metering.blockName,
          billing_mode: mode
        }
      );
    }

    if (!metering.primaryMeterDeviceId) {
      return createBlockingReason(
        ErrorCodes.RELATION_NOT_CONFIGURED,
        `${readinessLabel}时计量点未绑定主电表`,
        'metering',
        {
          scope: 'billing_meter',
          well_id: wellId,
          block_id: metering.blockId,
          block_name: metering.blockName,
          metering_point_id: metering.meteringPointId,
          metering_point_code: metering.meteringPointCode,
          billing_mode: mode
        }
      );
    }

    if (metering.primaryMeterLifecycleState !== 'active' || metering.primaryMeterOnlineState !== 'online') {
      return createBlockingReason(
        ErrorCodes.DEVICE_OFFLINE,
        `${readinessLabel}时主电表未在线，当前设备未就绪`,
        'metering',
        {
          deviceRole: 'meter',
          scope: 'billing_meter',
          well_id: wellId,
          block_id: metering.blockId,
          block_name: metering.blockName,
          metering_point_id: metering.meteringPointId,
          metering_point_code: metering.meteringPointCode,
          primary_meter_device_id: metering.primaryMeterDeviceId,
          primary_meter_device_name: metering.primaryMeterDeviceName,
          lifecycleState: metering.primaryMeterLifecycleState,
          onlineState: metering.primaryMeterOnlineState,
          billing_mode: mode
        }
      );
    }

    return null;
  }

  private normalizeBillingMode(value: unknown) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'time' || normalized === 'duration') return 'time';
    if (normalized === 'water' || normalized === 'volume') return 'water';
    if (normalized === 'energy' || normalized === 'electric') return 'electric';
    if (normalized === 'water_energy' || normalized === 'water_electric') return 'water_electric';
    if (normalized === 'flat') return 'flat';
    if (normalized === 'free') return 'free';
    return normalized || 'time';
  }

  async evaluateStartEligibility(
    input: { targetType: 'valve' | 'well' | 'pump' | 'session'; targetId: string; sceneCode: string; relationId?: string | null },
    runtimeUserId: string,
    tenantId: string,
    cardToken?: string | null,
    client?: PoolClient
  ) {
    const topology = await this.topologyService.validateStartTarget(input.targetType, input.targetId, input.relationId ?? null);
    const blockingReasons: BlockingReason[] = [...topology.blockingReasons];
    let effectiveRuleSnapshot: Record<string, unknown> = {
      priorityChain: [...FIXED_PRIORITY_CHAIN],
      resolved_from: {
        relationId: input.relationId ?? null
      }
    };
    let pricePreview: RuntimeDecisionContract['pricePreview'] = null;
    let availableActions: AvailableAction[] = [];

    if (topology.relation) {
      const policy = await this.effectivePolicyResolver.resolveForRuntime({
        wellId: topology.relation.wellId,
        pumpId: topology.relation.pumpId,
        valveId: topology.relation.valveId,
        relationId: topology.relation.relationId,
        targetType: input.targetType,
        sceneCode: input.sceneCode
      }).catch((error: unknown) => {
        if (error instanceof AppException) {
          const payload = error.getResponse() as { code: string; message: string; data?: Record<string, unknown> };
          blockingReasons.push(createBlockingReason(payload.code, payload.message, 'policy', payload.data));
          return null;
        }
        throw error;
      });

      if (policy) {
        const activeUserSessions = await this.runtimeRepository.countActiveSessionsForUser(runtimeUserId, client);
        const activeWellSessions = await this.runtimeRepository.countActiveSessionsForWell(policy.runtime.wellId, client);
        const activeValveSessions = await this.runtimeRepository.countActiveSessionsForValve(policy.runtime.valveId, client);
        const activePumpSessions = await this.runtimeRepository.countActiveSessionsForPump(policy.runtime.pumpId, client);
        const requestedBillingMode = this.normalizeBillingMode(policy.billing.billingMode);
        const meteringReadiness = this.requiresElectricMeterReadiness(requestedBillingMode)
          ? await this.topologyService.findPrimaryMeteringReadinessByWellId(policy.runtime.wellId)
          : null;
        const existingPumpBillingModes =
          activePumpSessions > 0
            ? (await this.runtimeRepository.listActiveBillingModesForPump(policy.runtime.pumpId, client)).map((mode) =>
                this.normalizeBillingMode(mode)
              )
            : [];

        if (activeUserSessions >= 1) {
          blockingReasons.push(
            createBlockingReason(
              ErrorCodes.CONCURRENCY_LIMIT_REACHED,
              'user already has an active runtime session',
              'runtime',
              { scope: 'user', limit: 1, current: activeUserSessions }
            )
          );
        }

        if (activeWellSessions >= policy.runtime.concurrencyLimit) {
          blockingReasons.push(
            createBlockingReason(
              ErrorCodes.CONCURRENCY_LIMIT_REACHED,
              `well concurrency limit ${policy.runtime.concurrencyLimit} reached`,
              'runtime',
              { scope: 'well', limit: policy.runtime.concurrencyLimit, current: activeWellSessions }
            )
          );
        }

        if (activeValveSessions > 0) {
          blockingReasons.push(
            createBlockingReason(
              ErrorCodes.CONCURRENCY_LIMIT_REACHED,
              'valve already has an active runtime session',
              'runtime',
              { scope: 'valve', limit: 1, current: activeValveSessions }
            )
          );
        }

        if (activePumpSessions > 0) {
          const sharedPumpBillingModes = new Set<string>([requestedBillingMode, ...existingPumpBillingModes]);
          const hasNonTimeBilling = [...sharedPumpBillingModes].some((mode) => mode !== 'time');
          if (hasNonTimeBilling) {
            blockingReasons.push(
              createBlockingReason(
                ErrorCodes.CONCURRENCY_LIMIT_REACHED,
                '当前水泵已有其他运行中订单，共享水泵场景只支持按时长计费',
                'billing',
                {
                  scope: 'pump_shared',
                  pump_id: policy.runtime.pumpId,
                  active_pump_sessions: activePumpSessions,
                  requested_billing_mode: requestedBillingMode,
                  existing_billing_modes: existingPumpBillingModes
                }
              )
            );
          }
        }

        if (cardToken?.trim() && blockingReasons.length === 0) {
          const minAmt = this.estimateMinChargeAmount(
            requestedBillingMode,
            Number(policy.billing.unitPrice ?? 0),
            Number(policy.billing.minChargeAmount ?? 0)
          );
          const bal = await this.farmerFundRepository.getBalance(tenantId, runtimeUserId, client);
          if (bal < minAmt) {
            blockingReasons.push(
              createBlockingReason(
                ErrorCodes.WALLET_INSUFFICIENT_BALANCE,
                `insufficient prepaid balance (need at least ${minAmt}, current ${bal})`,
                'wallet',
                { balance: bal, required: minAmt }
              )
            );
          }
        }

        const electricMeterBlockingReason = this.requiresElectricMeterReadiness(requestedBillingMode)
          ? this.buildElectricMeterBlockingReason(requestedBillingMode, meteringReadiness, policy.runtime.wellId)
          : null;
        if (electricMeterBlockingReason) {
          blockingReasons.push(electricMeterBlockingReason);
        }

        effectiveRuleSnapshot = {
          ...policy,
          relation: topology.relation,
          resolved_from: {
            ...policy.sourceIds,
            relationId: topology.relation.relationId
          },
          metering: {
            required: this.requiresElectricMeterReadiness(requestedBillingMode),
            billingMode: requestedBillingMode,
            ...(meteringReadiness ?? {})
          }
        };

        if (blockingReasons.length === 0) {
          pricePreview = {
            billingMode: policy.billing.billingMode,
            unitPrice: policy.billing.unitPrice,
            unitType: policy.billing.unitType,
            currency: 'CNY',
            minChargeAmount: policy.billing.minChargeAmount,
            billingPackageId: policy.billing.billingPackageId
          };
          availableActions = [
            createAvailableAction('START_SESSION', 'Start Session', policy.interaction.confirmMode !== 'no_confirm')
          ];
        }
      }
    }

    const result: RuntimeDecisionContract['result'] = blockingReasons.length === 0 ? 'allow' : 'deny';
    if (result === 'deny') {
      pricePreview = null;
      availableActions = this.buildDenyActions(blockingReasons);
    }

    return {
      targetType: input.targetType,
      targetId: input.targetId,
      sceneCode: input.sceneCode,
      result,
      blockingReasons,
      availableActions,
      effectiveRuleSnapshot,
      pricePreview
    };
  }

  private buildDenyActions(blockingReasons: BlockingReason[]): AvailableAction[] {
    const codes = new Set<string>();
    for (const reason of blockingReasons) {
      if (reason.code === ErrorCodes.CONCURRENCY_LIMIT_REACHED || reason.code === ErrorCodes.DEVICE_OFFLINE) {
        codes.add('retry_later');
      } else {
        codes.add('contact_support');
      }
    }

    return [...codes].map((code) =>
      createAvailableAction(code, code === 'retry_later' ? 'Retry Later' : 'Contact Support', false)
    );
  }

  async getRuntimeUser(cardToken?: string | null) {
    if (cardToken?.trim()) {
      const row = await this.farmerFundRepository.findActiveCardUser(cardToken.trim());
      if (!row) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Card not found or inactive', 404, {
          cardToken: cardToken.trim()
        });
      }
      return row;
    }
    const runtimeUser = await this.runtimeRepository.findDefaultRuntimeUser();
    if (!runtimeUser) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'No default runtime user found for local validation');
    }
    return runtimeUser;
  }
}

@Injectable()
export class RuntimeService {
  constructor(
    private readonly runtimeDecisionService: RuntimeDecisionService,
    private readonly runtimeRepository: RuntimeRepository,
    private readonly orderRepository: OrderRepository,
    private readonly sessionStatusLogRepository: SessionStatusLogRepository,
    @Inject(forwardRef(() => DeviceGatewayService))
    private readonly deviceGatewayService: DeviceGatewayService,
    @Inject(forwardRef(() => TcpJsonV1Server))
    private readonly tcpServer: TcpJsonV1Server,
    private readonly orderSettlementService: OrderSettlementService,
    private readonly runtimeIngestRepository: RuntimeIngestRepository
  ) {}

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
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return null;
  }

  private asObject(value: unknown) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private resolveSessionControlRoute(
    role: 'pump' | 'valve',
    targets: {
      wellFeatureModules?: unknown;
      wellDeviceState?: string | null;
      wellOnlineState?: string | null;
      wellDeviceId?: string | null;
      wellImei?: string | null;
      pumpDeviceState?: string | null;
      pumpOnlineState?: string | null;
      pumpDeviceId?: string | null;
      pumpImei?: string | null;
      valveDeviceState?: string | null;
      valveOnlineState?: string | null;
      valveDeviceId?: string | null;
      valveImei?: string | null;
    }
  ) {
    return resolveRoleControlRoute({
      role,
      wellFeatureModules: targets.wellFeatureModules,
      wellDeviceState: targets.wellDeviceState,
      wellOnlineState: targets.wellOnlineState,
      wellDeviceId: targets.wellDeviceId,
      wellImei: targets.wellImei,
      dedicatedDeviceState: role === 'pump' ? targets.pumpDeviceState : targets.valveDeviceState,
      dedicatedOnlineState: role === 'pump' ? targets.pumpOnlineState : targets.valveOnlineState,
      dedicatedDeviceId: role === 'pump' ? targets.pumpDeviceId : targets.valveDeviceId,
      dedicatedImei: role === 'pump' ? targets.pumpImei : targets.valveImei
    });
  }

  private resolveStartSequence(relationConfigJson: Record<string, unknown>) {
    const sequence = String(relationConfigJson.sequence ?? 'valve_first').toLowerCase();
    if (sequence === 'simultaneous' || sequence === 'pump_first') return sequence;
    return 'valve_first';
  }

  private buildFarmerStopOrderSnapshot(order: Record<string, any>) {
    const pricingDetail = (order.pricingDetail ?? {}) as Record<string, any>;
    const paymentStatus = String(order.paymentStatus ?? '').trim() || null;
    const stopReasonCode = String(order.endReasonCode ?? '').trim() || null;
    const abnormalStop =
      Boolean(pricingDetail.stop_summary?.abnormal_stop) ||
      stopReasonCode === 'power_loss_stop' ||
      stopReasonCode === 'device_runtime_stopped';
    const lifecycleStage = deriveFormalOrderLifecycleStage({
      explicitLifecycle: pricingDetail.lifecycle_stage,
      orderStatus: order.status,
      sessionStatus: order.sessionStatus,
      pricingDetail
    });

    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      settlementStatus: order.settlementStatus,
      amount: Number(order.amount ?? 0),
      paymentMode: order.paymentMode ?? null,
      paymentStatus,
      prepaidAmount: Number(order.prepaidAmount ?? 0),
      lockedAmount: Number(order.lockedAmount ?? 0),
      refundedAmount: Number(order.refundedAmount ?? 0),
      targetImei: order.targetImei ?? null,
      targetDeviceRole: order.targetDeviceRole ?? null,
      stopReasonCode,
      abnormalStop,
      lifecycleStage
    };
  }

  private assertManualControlCardAuthority(
    order: Record<string, any>,
    cardToken: string | null,
    sessionId: string,
    action: 'pause' | 'resume' | 'stop'
  ) {
    const starterCardToken = this.asString(order.checkoutSnapshot?.card_token);
    const normalizedCardToken = this.asString(cardToken);
    if ((order.orderChannel === 'CARD' || order.paymentMode === 'card' || starterCardToken) && starterCardToken !== normalizedCardToken) {
      throw new AppException(
        ErrorCodes.FORBIDDEN,
        `当前订单只能由启动该订单的原卡${action === 'stop' ? '结束' : action === 'pause' ? '暂停' : '恢复'}，请使用同一张卡再次操作`,
        403,
        {
          sessionId,
          orderId: order.id,
          starterCardToken: starterCardToken || null,
          currentCardToken: normalizedCardToken || null
        }
      );
    }
  }

  private extractGatewayPayload(value: unknown) {
    const container = this.asObject(value);
    return this.asObject(
      container.gateway_payload ?? container.gatewayPayload ?? container.payload
    );
  }

  private resolveLatestDeviceQueries(
    commands: Array<{
      requestPayload: Record<string, unknown>;
      responsePayload: Record<string, unknown>;
      ackedAt?: string | null;
      failedAt?: string | null;
      updatedAt?: string | null;
      createdAt?: string | null;
    }>
  ) {
    const latestByQueryCode = new Map<
      string,
      {
        payload: Record<string, unknown>;
        updatedAt: string | null;
      }
    >();

    for (const command of commands) {
      const requestPayload = this.asObject(command.requestPayload);
      const queryCode = this.asString(requestPayload.query_code ?? requestPayload.queryCode).toLowerCase();
      if (!queryCode || latestByQueryCode.has(queryCode)) {
        continue;
      }
      latestByQueryCode.set(queryCode, {
        payload: this.extractGatewayPayload(command.responsePayload),
        updatedAt: this.asString(command.ackedAt ?? command.failedAt ?? command.updatedAt ?? command.createdAt) || null
      });
    }

    return {
      commonStatus: latestByQueryCode.get('query_common_status') ?? null,
      workflowState: latestByQueryCode.get('query_workflow_state') ?? null
    };
  }

  private getSynchronousStartTimeoutMs() {
    const raw = this.asNumber(process.env.RUNTIME_SYNC_START_TIMEOUT_MS);
    if (raw === null) return 15_000;
    return Math.min(Math.max(Math.trunc(raw), 3_000), 60_000);
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private normalizeQueuedCommandToken(command: Record<string, unknown>) {
    return this.asString(command.command_token ?? command.commandToken);
  }

  private normalizeQueuedCommandId(command: Record<string, unknown>) {
    return this.asString(command.id);
  }

  private normalizeQueuedCommandCode(command: Record<string, unknown>) {
    return this.asString(command.command_code ?? command.commandCode).toUpperCase();
  }

  private isTimeoutLikeFailureReason(reasonCode: string) {
    const normalized = this.asString(reasonCode).toLowerCase();
    return normalized.includes('timeout') || normalized.includes('timed_out');
  }

  private isRunningChannelState(value: unknown) {
    return this.asString(value).toLowerCase() === 'running';
  }

  private isOpenValveChannelState(value: unknown) {
    return this.asString(value).toLowerCase() === 'open';
  }

  private async loadQueuedCommandStates(
    commandIds: string[],
    client: PoolClient
  ): Promise<Array<{
    id: string;
    commandCode: string;
    commandStatus: string;
    imei: string;
    targetDeviceId: string | null;
    requestPayload: Record<string, unknown>;
  }>> {
    if (commandIds.length === 0) {
      return [];
    }

    const result = await client.query<{
      id: string;
      commandCode: string;
      commandStatus: string;
      imei: string;
      targetDeviceId: string | null;
      requestPayload: Record<string, unknown>;
    }>(
      `
      select
        id::text as id,
        command_code as "commandCode",
        command_status as "commandStatus",
        imei,
        target_device_id::text as "targetDeviceId",
        request_payload_json as "requestPayload"
      from device_command
      where id = any($1::uuid[])
      `,
      [commandIds]
    );

    return result.rows;
  }

  private async markQueuedCommandsDeadLetter(
    sessionId: string,
    queuedCommands: Array<Record<string, unknown>>,
    input: {
      reasonCode: string;
      reasonText: string;
      transitionCode: string;
    },
    client: PoolClient
  ) {
    const commandIds = queuedCommands
      .map((command) => this.normalizeQueuedCommandId(command))
      .filter((value): value is string => Boolean(value));
    const commandTokens = queuedCommands
      .map((command) => this.normalizeQueuedCommandToken(command))
      .filter((value): value is string => Boolean(value));

    if (commandIds.length === 0 && commandTokens.length === 0) {
      return;
    }

    const transportPatch = JSON.stringify({
      transport: {
        retryable: false,
        last_transition: input.transitionCode,
        dead_letter_reason: input.reasonCode,
        reason_text: input.reasonText
      }
    });

    if (commandIds.length > 0) {
      await client.query(
        `
        update device_command
        set command_status = 'dead_letter',
            failed_at = coalesce(failed_at, now()),
            timeout_at = coalesce(timeout_at, now()),
            response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb,
            updated_at = now()
        where id = any($1::uuid[])
          and command_status in ('created', 'sent', 'retry_pending')
        `,
        [commandIds, transportPatch]
      );
    }

    if (commandTokens.length > 0) {
      await client.query(
        `
        update command_dispatch
        set dispatch_status = 'dead_letter',
            sent_at = null,
            response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb
        where session_id = $1::uuid
          and coalesce(
            request_payload_json->>'device_command_token',
            request_payload_json->>'command_token',
            request_payload_json->>'device_command_id',
            request_payload_json->>'command_id'
          ) = any($3::text[])
          and dispatch_status in ('created', 'sent', 'retry_pending')
        `,
        [sessionId, transportPatch, commandTokens]
      );
    }
  }

  private async shouldCompensateRoleFromRuntimeState(
    role: 'pump' | 'valve',
    tenantId: string,
    imei: string | null | undefined,
    client: PoolClient
  ) {
    const normalizedImei = this.asString(imei);
    if (!normalizedImei) return false;

    const runtimeShadow = await this.runtimeIngestRepository.findRuntimeShadowByImei(tenantId, normalizedImei, client);
    const channelLatest = await this.runtimeIngestRepository.listChannelLatest(
      {
        tenantId,
        imei: normalizedImei,
        metricCode: 'state',
        limit: 50
      },
      client
    );

    if (role === 'pump') {
      if (
        isActiveRuntimeWorkflowState(runtimeShadow?.workflowState) ||
        ['running', 'billing', 'active'].includes(this.asString(runtimeShadow?.runState).toLowerCase())
      ) {
        return true;
      }
      return channelLatest.some(
        (row) => row.channelCode.startsWith('pump_') && this.isRunningChannelState(row.valueText)
      );
    }

    return channelLatest.some(
      (row) => row.channelCode.startsWith('valve_') && this.isOpenValveChannelState(row.valueText)
    );
  }

  private async dispatchQueuedCommandsImmediately(
    queuedCommands: Array<Record<string, unknown>>
  ) {
    const deliveries: Array<Record<string, unknown>> = [];
    const orderedCommands = [...queuedCommands].sort((left, right) => {
      const leftStep = this.asNumber(left.step_no ?? left.stepNo) ?? 0;
      const rightStep = this.asNumber(right.step_no ?? right.stepNo) ?? 0;
      return leftStep - rightStep;
    });

    let elapsedDelaySeconds = 0;
    for (const command of orderedCommands) {
      const commandToken = this.normalizeQueuedCommandToken(command);
      if (!commandToken) continue;
      const stepDelaySeconds = Math.max(this.asNumber(command.delay_seconds ?? command.delaySeconds) ?? 0, 0);
      if (stepDelaySeconds > elapsedDelaySeconds) {
        await this.sleep((stepDelaySeconds - elapsedDelaySeconds) * 1000);
        elapsedDelaySeconds = stepDelaySeconds;
      }
      deliveries.push({
        command_token: commandToken,
        command_code: this.normalizeQueuedCommandCode(command),
        delivery: await this.tcpServer.dispatchQueuedCommandNow(commandToken)
      });
    }

    return deliveries;
  }

  private async dispatchPendingStartFailureCompensation(input: {
    session: Awaited<ReturnType<RuntimeRepository['findSessionById']>>;
    queuedCommands: Array<Record<string, unknown>>;
    orderId?: string | null;
    reasonCode: string;
    client: PoolClient;
  }) {
    const session = input.session;
    if (!session) {
      return null;
    }

    const commandIds = input.queuedCommands
      .map((command) => this.normalizeQueuedCommandId(command))
      .filter((value): value is string => Boolean(value));
    const startCommands = await this.loadQueuedCommandStates(commandIds, input.client);
    if (startCommands.length === 0) {
      return null;
    }

    const timeoutLikeFailure = this.isTimeoutLikeFailureReason(input.reasonCode);
    const requestedRoles = new Set<'pump' | 'valve'>();
    const rolesToCompensate = new Set<'pump' | 'valve'>();

    for (const command of startCommands) {
      const role = this.asString(command.requestPayload.role).toLowerCase();
      if (role !== 'pump' && role !== 'valve') continue;
      requestedRoles.add(role);
      const commandStatus = this.asString(command.commandStatus).toLowerCase();
      if (commandStatus === 'acked') {
        rolesToCompensate.add(role);
        continue;
      }
      if (timeoutLikeFailure && ['sent', 'dead_letter'].includes(commandStatus)) {
        rolesToCompensate.add(role);
      }
    }

    if (rolesToCompensate.size < requestedRoles.size && session.wellId && session.pumpId && session.valveId) {
      const targets = await this.runtimeRepository.findSessionControlTargets(
        {
          wellId: session.wellId,
          pumpId: session.pumpId,
          valveId: session.valveId
        },
        input.client
      );
      if (targets) {
        for (const role of requestedRoles) {
          if (rolesToCompensate.has(role)) continue;
          const route = this.resolveSessionControlRoute(role, targets);
          if (await this.shouldCompensateRoleFromRuntimeState(role, session.tenantId, route.imei, input.client)) {
            rolesToCompensate.add(role);
          }
        }
      }
    }

    if (rolesToCompensate.size === 0 || !session.wellId || !session.pumpId || !session.valveId) {
      return null;
    }

    const queuedStopCommands = await this.queueSessionStopCommands({
      sessionId: session.id,
      sessionRef: session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`,
      orderId: input.orderId ?? null,
      relation: {
        relationId: null,
        wellId: session.wellId,
        pumpId: session.pumpId,
        valveId: session.valveId
      },
      roles: [...rolesToCompensate],
      client: input.client
    });

    const deliveryResults = await this.dispatchQueuedCommandsImmediately(queuedStopCommands.queued_commands);
    const undeliveredCommands = queuedStopCommands.queued_commands.filter((command) => {
      const commandToken = this.normalizeQueuedCommandToken(command);
      const delivery = deliveryResults.find((item) => this.asString(item.command_token) === commandToken);
      return this.asBoolean(this.asObject(delivery?.delivery).delivered) !== true;
    });

    if (undeliveredCommands.length > 0) {
      await this.markQueuedCommandsDeadLetter(
        session.id,
        undeliveredCommands,
        {
          reasonCode: 'start_failure_compensation_dispatch_failed',
          reasonText: 'failed to deliver compensation stop command after start failure',
          transitionCode: 'start_failure_compensation_closed'
        },
        input.client
      );
    }

    await this.sessionStatusLogRepository.create(
      {
        tenantId: session.tenantId,
        sessionId: session.id,
        fromStatus: 'ended',
        toStatus: 'ended',
        actionCode: 'start_failure_compensation_requested',
        reasonCode: input.reasonCode,
        reasonText: 'queued compensation stop commands after pending start failure',
        source: 'system',
        snapshot: {
          compensated_roles: [...rolesToCompensate],
          start_commands: startCommands.map((command) => ({
            id: command.id,
            imei: command.imei,
            command_code: command.commandCode,
            command_status: command.commandStatus,
            role: this.asString(command.requestPayload.role) || null,
            workflow_state: normalizeRuntimeWorkflowState(command.requestPayload.workflow_state) || null
          })),
          queued_compensation_commands: queuedStopCommands.queued_commands,
          delivery_results: deliveryResults
        }
      },
      input.client
    );

    return {
      roles: [...rolesToCompensate],
      queuedCommands: queuedStopCommands.queued_commands,
      deliveryResults
    };
  }

  private resolveSyncStartFailureCode(order: Record<string, any> | null, fallback: keyof typeof ErrorCodes) {
    const reasonCode = this.asString(order?.pricingDetail?.start_failure_reason_code).toLowerCase();
    const failureSource = this.asString(order?.pricingDetail?.start_failure_source).toLowerCase();
    if (reasonCode.includes('timeout') || failureSource === 'command_timeout') {
      return ErrorCodes.STARTUP_TIMEOUT;
    }
    if (reasonCode.includes('offline') || reasonCode.includes('disconnect')) {
      return ErrorCodes.DEVICE_OFFLINE;
    }
    return fallback;
  }

  private async cancelPendingStartSession(
    sessionId: string,
    queuedCommands: Array<Record<string, unknown>>,
    input: {
      reasonCode: string;
      reasonText: string;
      failureSource: string;
      failureMessage: string;
      gatewayEventType?: string | null;
      gatewayEventCode?: string | null;
      snapshot?: Record<string, unknown>;
    }
  ) {
    return this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(sessionId, client, true);
      if (!session || session.status !== 'pending_start') {
        return null;
      }

      const commandIds = queuedCommands
        .map((command) => this.normalizeQueuedCommandId(command))
        .filter((value): value is string => Boolean(value));
      const commandTokens = queuedCommands
        .map((command) => this.normalizeQueuedCommandToken(command))
        .filter((value): value is string => Boolean(value));
      const cancelledAt = new Date().toISOString();
      const transportPatch = JSON.stringify({
        transport: {
          retryable: false,
          last_transition: 'sync_start_cancelled',
          sync_start_cancelled_at: cancelledAt,
          dead_letter_reason: input.gatewayEventCode ?? input.reasonCode,
          reason_text: input.reasonText
        }
      });

      if (commandIds.length > 0) {
        await client.query(
          `
          update device_command
          set command_status = 'dead_letter',
              failed_at = now(),
              timeout_at = coalesce(timeout_at, now()),
              response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb,
              updated_at = now()
          where id = any($1::uuid[])
            and command_status in ('created', 'sent', 'retry_pending')
          `,
          [commandIds, transportPatch]
        );
      }

      if (commandTokens.length > 0) {
        await client.query(
          `
          update command_dispatch
          set dispatch_status = 'dead_letter',
              sent_at = null,
              response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb
          where session_id = $1::uuid
            and coalesce(
              request_payload_json->>'device_command_token',
              request_payload_json->>'command_token',
              request_payload_json->>'device_command_id',
              request_payload_json->>'command_id'
            ) = any($3::text[])
            and dispatch_status in ('created', 'sent', 'retry_pending')
          `,
          [sessionId, transportPatch, commandTokens]
        );
      }

      const endedAt = cancelledAt;
      await client.query(
        `
        update runtime_session
        set status = 'ended',
            ended_at = coalesce(ended_at, $2::timestamptz),
            end_reason_code = $3,
            updated_at = now()
        where id = $1::uuid
          and status = 'pending_start'
        `,
        [session.id, endedAt, input.reasonCode]
      );

      await this.sessionStatusLogRepository.create(
        {
          tenantId: session.tenantId,
          sessionId: session.id,
          fromStatus: 'pending_start',
          toStatus: 'ended',
          actionCode: 'start_session_failed',
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          source: 'system',
          snapshot: {
            ended_at: endedAt,
            session_ref: session.sessionRef ?? null,
            failure_source: input.failureSource,
            failure_message: input.failureMessage,
            gateway_event_type: input.gatewayEventType ?? null,
            gateway_event_code: input.gatewayEventCode ?? input.reasonCode,
            cancelled_command_ids: commandIds,
            cancelled_command_tokens: commandTokens,
            ...(input.snapshot ?? {})
          }
        },
        client
      );

      const settled = await this.orderSettlementService.cancelOrderBeforeStart(session.id, client, {
        settledAt: endedAt,
        gatewayEventType: input.gatewayEventType ?? 'SYNC_START_FAILED',
        gatewayEventCode: input.gatewayEventCode ?? input.reasonCode,
        failureSource: input.failureSource,
        failureMessage: input.failureMessage
      });

      if (settled) {
        await this.sessionStatusLogRepository.create(
          {
            tenantId: session.tenantId,
            sessionId: session.id,
            fromStatus: 'ended',
            toStatus: 'settled',
            actionCode: 'start_failure_refunded',
            reasonCode: input.reasonCode,
            reasonText: 'irrigation order closed immediately after synchronous start failure',
            source: 'system',
            snapshot: {
              session_ref: session.sessionRef ?? null,
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

      await this.dispatchPendingStartFailureCompensation({
        session,
        queuedCommands,
        orderId: settled?.orderId ?? null,
        reasonCode: input.reasonCode,
        client
      });

      return {
        sessionId: session.id,
        orderId: settled?.orderId ?? null
      };
    });
  }

  private async confirmStartSynchronously(result: {
    sessionId: string;
    status: string;
    sessionNo: string;
    sessionRef: string | null;
    queuedCommands: Array<Record<string, unknown>>;
  }) {
    if (result.status !== 'pending_start') {
      return result;
    }

    const queuedCommands = Array.isArray(result.queuedCommands) ? result.queuedCommands : [];
    if (queuedCommands.length === 0) {
      await this.cancelPendingStartSession(result.sessionId, queuedCommands, {
        reasonCode: 'sync_start_command_missing',
        reasonText: 'start request failed because no start command was generated',
        failureSource: 'platform_sync_start',
        failureMessage: 'no start command generated for synchronous start'
      });
      throw new AppException(ErrorCodes.INTERNAL_ERROR, 'start failed because no start command was generated', 500, {
        sessionId: result.sessionId
      });
    }

    const deliveryResults: Array<Record<string, unknown>> = [];
    for (const command of queuedCommands) {
      const commandToken = this.normalizeQueuedCommandToken(command);
      if (!commandToken) continue;
      deliveryResults.push({
        command_token: commandToken,
        command_code: this.normalizeQueuedCommandCode(command),
        delivery: await this.tcpServer.dispatchQueuedCommandNow(commandToken)
      });
    }

    const failedDelivery = deliveryResults.find(
      (item) => this.asBoolean(this.asObject(item.delivery).delivered) !== true
    );
    if (failedDelivery) {
      const delivery = this.asObject(failedDelivery.delivery);
      const reasonCode =
        this.asString(delivery.reason) === 'device_not_connected' ? 'device_not_connected' : 'socket_write_failed';
      await this.cancelPendingStartSession(result.sessionId, queuedCommands, {
        reasonCode,
        reasonText: 'start request failed because the command could not be delivered immediately',
        failureSource: 'platform_sync_dispatch',
        failureMessage: this.asString(delivery.reason) || 'dispatch_failed',
        snapshot: {
          delivery_results: deliveryResults
        }
      });
      throw new AppException(
        this.asString(delivery.reason) === 'device_not_connected' ? ErrorCodes.DEVICE_OFFLINE : ErrorCodes.STARTUP_TIMEOUT,
        this.asString(delivery.reason) === 'device_not_connected'
          ? 'device is offline and start was rejected'
          : 'failed to deliver the start command synchronously',
        400,
        {
          sessionId: result.sessionId,
          delivery_results: deliveryResults
        }
      );
    }

    const deadline = Date.now() + this.getSynchronousStartTimeoutMs();
    while (Date.now() < deadline) {
      const session = await this.runtimeRepository.findSessionById(result.sessionId);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId: result.sessionId
        });
      }

      if (session.status === 'running' || session.status === 'billing') {
        return {
          ...result,
          status: session.status
        };
      }

      if (session.status === 'ended') {
        const order = await this.orderRepository.findBySessionId(result.sessionId);
        const failureMessage =
          this.asString(order?.pricingDetail?.start_failure_message) || 'device start failed';
        const failureCode = this.resolveSyncStartFailureCode(order, ErrorCodes.FORBIDDEN);
        throw new AppException(failureCode, failureMessage, 400, {
          sessionId: result.sessionId,
          orderId: order?.id ?? null,
          start_failure_reason_code: this.asString(order?.pricingDetail?.start_failure_reason_code) || null,
          start_failure_source: this.asString(order?.pricingDetail?.start_failure_source) || null
        });
      }

      await this.sleep(250);
    }

    await this.cancelPendingStartSession(result.sessionId, queuedCommands, {
      reasonCode: 'sync_start_timeout',
      reasonText: 'start request timed out before device acknowledgement',
      failureSource: 'platform_sync_wait',
      failureMessage: 'device acknowledgement timeout',
      snapshot: {
        delivery_results: deliveryResults
      }
    });

    throw new AppException(ErrorCodes.STARTUP_TIMEOUT, 'start timed out and was closed as failed', 400, {
      sessionId: result.sessionId,
      delivery_results: deliveryResults
    });
  }

  private async cancelPendingSessionControlRequest(input: {
    sessionId: string;
    queuedCommands: Array<Record<string, unknown>>;
    expectedStatus: string;
    restoreStatus: string;
    mode: 'pause' | 'resume';
    reasonCode: string;
    reasonText: string;
    failureSource: string;
    failureMessage: string;
    snapshot?: Record<string, unknown>;
  }) {
    return this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(input.sessionId, client, true);
      if (!session || session.status !== input.expectedStatus) {
        return null;
      }

      const commandIds = input.queuedCommands
        .map((command) => this.normalizeQueuedCommandId(command))
        .filter((value): value is string => Boolean(value));
      const commandTokens = input.queuedCommands
        .map((command) => this.normalizeQueuedCommandToken(command))
        .filter((value): value is string => Boolean(value));
      const failedAt = new Date().toISOString();
      const transportPatch = JSON.stringify({
        transport: {
          retryable: false,
          last_transition: `${input.mode}_sync_cancelled`,
          sync_cancelled_at: failedAt,
          dead_letter_reason: input.reasonCode,
          reason_text: input.reasonText
        }
      });

      if (commandIds.length > 0) {
        await client.query(
          `
          update device_command
          set command_status = 'dead_letter',
              failed_at = now(),
              timeout_at = coalesce(timeout_at, now()),
              response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb,
              updated_at = now()
          where id = any($1::uuid[])
            and command_status in ('created', 'sent', 'retry_pending')
          `,
          [commandIds, transportPatch]
        );
      }

      if (commandTokens.length > 0) {
        await client.query(
          `
          update command_dispatch
          set dispatch_status = 'dead_letter',
              sent_at = null,
              response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb
          where session_id = $1::uuid
            and coalesce(
              request_payload_json->>'device_command_token',
              request_payload_json->>'command_token',
              request_payload_json->>'device_command_id',
              request_payload_json->>'command_id'
            ) = any($3::text[])
            and dispatch_status in ('created', 'sent', 'retry_pending')
          `,
          [input.sessionId, transportPatch, commandTokens]
        );
      }

      await client.query(
        `
        update runtime_session
        set status = $2,
            updated_at = now()
        where id = $1::uuid
          and status = $3
        `,
        [session.id, input.restoreStatus, input.expectedStatus]
      );

      if (input.mode === 'pause') {
        await this.orderSettlementService.cancelPauseOrResumeRequest(session.id, client, {
          mode: 'pause',
          restoreStatus: input.restoreStatus as 'running' | 'paused',
          failedAt,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          source: input.failureSource
        });
      } else {
        await this.orderSettlementService.cancelPauseOrResumeRequest(session.id, client, {
          mode: 'resume',
          restoreStatus: input.restoreStatus as 'running' | 'paused',
          failedAt,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          source: input.failureSource
        });
      }

      await this.sessionStatusLogRepository.create(
        {
          tenantId: session.tenantId,
          sessionId: session.id,
          fromStatus: input.expectedStatus,
          toStatus: input.restoreStatus,
          actionCode: input.mode === 'pause' ? 'pause_session_failed' : 'resume_session_failed',
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          source: 'system',
          snapshot: {
            session_ref: session.sessionRef ?? null,
            failure_source: input.failureSource,
            failure_message: input.failureMessage,
            cancelled_command_ids: commandIds,
            cancelled_command_tokens: commandTokens,
            ...(input.snapshot ?? {})
          }
        },
        client
      );

      return {
        sessionId: session.id
      };
    });
  }

  private async confirmSessionControlSynchronously(input: {
    sessionId: string;
    queuedCommands: Array<Record<string, unknown>>;
    expectedPendingStatus: string;
    successStatuses: string[];
    restoreStatus: string;
    timeoutErrorCode: keyof typeof ErrorCodes;
    timeoutMessage: string;
    mode: 'pause' | 'resume';
  }) {
    const queuedCommands = Array.isArray(input.queuedCommands) ? input.queuedCommands : [];
    if (queuedCommands.length === 0) {
      await this.cancelPendingSessionControlRequest({
        sessionId: input.sessionId,
        queuedCommands,
        expectedStatus: input.expectedPendingStatus,
        restoreStatus: input.restoreStatus,
        mode: input.mode,
        reasonCode: `${input.mode}_command_missing`,
        reasonText: `${input.mode} request failed because no control command was generated`,
        failureSource: `platform_sync_${input.mode}`,
        failureMessage: 'no control command generated'
      });
      throw new AppException(ErrorCodes.INTERNAL_ERROR, `${input.mode} failed because no control command was generated`, 500, {
        sessionId: input.sessionId
      });
    }

    const deliveryResults: Array<Record<string, unknown>> = [];
    for (const command of queuedCommands) {
      const commandToken = this.normalizeQueuedCommandToken(command);
      if (!commandToken) continue;
      deliveryResults.push({
        command_token: commandToken,
        command_code: this.normalizeQueuedCommandCode(command),
        delivery: await this.tcpServer.dispatchQueuedCommandNow(commandToken)
      });
    }

    const failedDelivery = deliveryResults.find(
      (item) => this.asBoolean(this.asObject(item.delivery).delivered) !== true
    );
    if (failedDelivery) {
      const delivery = this.asObject(failedDelivery.delivery);
      await this.cancelPendingSessionControlRequest({
        sessionId: input.sessionId,
        queuedCommands,
        expectedStatus: input.expectedPendingStatus,
        restoreStatus: input.restoreStatus,
        mode: input.mode,
        reasonCode: this.asString(delivery.reason) === 'device_not_connected' ? 'device_not_connected' : `${input.mode}_dispatch_failed`,
        reasonText: `${input.mode} request failed because the command could not be delivered immediately`,
        failureSource: `platform_sync_${input.mode}_dispatch`,
        failureMessage: this.asString(delivery.reason) || 'dispatch_failed',
        snapshot: {
          delivery_results: deliveryResults
        }
      });
      throw new AppException(
        this.asString(delivery.reason) === 'device_not_connected' ? ErrorCodes.DEVICE_OFFLINE : input.timeoutErrorCode,
        this.asString(delivery.reason) === 'device_not_connected'
          ? `device is offline and ${input.mode} was rejected`
          : `failed to deliver the ${input.mode} command synchronously`,
        400,
        {
          sessionId: input.sessionId,
          delivery_results: deliveryResults
        }
      );
    }

    const deadline = Date.now() + this.getSynchronousStartTimeoutMs();
    while (Date.now() < deadline) {
      const session = await this.runtimeRepository.findSessionById(input.sessionId);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId: input.sessionId
        });
      }

      if (input.successStatuses.includes(session.status)) {
        return {
          sessionId: session.id,
          status: session.status,
          queuedCommands
        };
      }

      const failedCommands = await Promise.all(
        queuedCommands
          .map((command) => this.normalizeQueuedCommandId(command))
          .filter((value): value is string => Boolean(value))
          .map((commandId) => this.deviceGatewayService.getCommand(commandId).catch(() => null))
      );
      const failedCommand = failedCommands.find((command) => {
        const status = this.asString(command?.commandStatus).toLowerCase();
        return status === 'failed' || status === 'nack' || status === 'dead_letter';
      });
      if (failedCommand) {
        const failedStatus = this.asString(failedCommand.commandStatus) || 'failed';
        await this.cancelPendingSessionControlRequest({
          sessionId: input.sessionId,
          queuedCommands,
          expectedStatus: input.expectedPendingStatus,
          restoreStatus: input.restoreStatus,
          mode: input.mode,
          reasonCode: `${input.mode}_command_${failedStatus.toLowerCase()}`,
          reasonText: `${input.mode} request failed after device rejected or timed out the workflow command`,
          failureSource: `platform_sync_${input.mode}_wait`,
          failureMessage: failedStatus,
          snapshot: {
            delivery_results: deliveryResults,
            failed_command_id: failedCommand.id ?? null,
            failed_command_status: failedStatus
          }
        });
        throw new AppException(input.timeoutErrorCode, `${input.mode} request failed`, 400, {
          sessionId: input.sessionId,
          failed_command_id: failedCommand.id ?? null,
          failed_command_status: failedStatus
        });
      }

      await this.sleep(250);
    }

    await this.cancelPendingSessionControlRequest({
      sessionId: input.sessionId,
      queuedCommands,
      expectedStatus: input.expectedPendingStatus,
      restoreStatus: input.restoreStatus,
      mode: input.mode,
      reasonCode: `sync_${input.mode}_timeout`,
      reasonText: `${input.mode} request timed out before device acknowledgement`,
      failureSource: `platform_sync_${input.mode}_wait`,
      failureMessage: 'device acknowledgement timeout',
      snapshot: {
        delivery_results: deliveryResults
      }
    });

    throw new AppException(input.timeoutErrorCode, input.timeoutMessage, 400, {
      sessionId: input.sessionId,
      delivery_results: deliveryResults
    });
  }

  private async queueSessionStartCommands(input: {
    sessionId: string;
    sessionRef: string | null;
    orderId: string;
    relation: Record<string, any>;
    client: PoolClient;
  }) {
    const targets = await this.runtimeRepository.findSessionControlTargets(
      {
        wellId: input.relation.wellId,
        pumpId: input.relation.pumpId,
        valveId: input.relation.valveId
      },
      input.client
    );

    if (!targets) {
      return {
        startToken: null,
        sequence: 'valve_first',
        queued_commands: []
      };
    }

    const sequence = this.resolveStartSequence((input.relation.relationConfigJson ?? {}) as Record<string, unknown>);
    const startToken = `start-${input.sessionId.slice(0, 8)}`;
    const pumpDelaySeconds = Number(input.relation.relationConfigJson?.pumpDelaySeconds ?? 0);
    const valveDelaySeconds = Number(input.relation.relationConfigJson?.valveDelaySeconds ?? 0);
    const pumpRoute = this.resolveSessionControlRoute('pump', targets);
    const valveRoute = this.resolveSessionControlRoute('valve', targets);
    const steps =
      sequence === 'simultaneous'
        ? [
            {
              role: 'pump',
              deviceId: pumpRoute.deviceId,
              imei: pumpRoute.imei,
              commandCode: 'START_PUMP',
              delaySeconds: pumpDelaySeconds,
              route: pumpRoute.route
            },
            {
              role: 'valve',
              deviceId: valveRoute.deviceId,
              imei: valveRoute.imei,
              commandCode: 'OPEN_VALVE',
              delaySeconds: valveDelaySeconds,
              route: valveRoute.route
            }
          ]
        : sequence === 'pump_first'
          ? [
              {
                role: 'pump',
                deviceId: pumpRoute.deviceId,
                imei: pumpRoute.imei,
                commandCode: 'START_PUMP',
                delaySeconds: pumpDelaySeconds,
                route: pumpRoute.route
              },
              {
                role: 'valve',
                deviceId: valveRoute.deviceId,
                imei: valveRoute.imei,
                commandCode: 'OPEN_VALVE',
                delaySeconds: valveDelaySeconds,
                route: valveRoute.route
              }
            ]
          : [
              {
                role: 'valve',
                deviceId: valveRoute.deviceId,
                imei: valveRoute.imei,
                commandCode: 'OPEN_VALVE',
                delaySeconds: valveDelaySeconds,
                route: valveRoute.route
              },
              {
                role: 'pump',
                deviceId: pumpRoute.deviceId,
                imei: pumpRoute.imei,
                commandCode: 'START_PUMP',
                delaySeconds: pumpDelaySeconds,
                route: pumpRoute.route
              }
            ];

    const queuedCommands: Array<Record<string, unknown>> = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (!step.deviceId || !step.imei) continue;
      const queued = await this.deviceGatewayService.queueCommand(
        {
          target_device_id: step.deviceId,
          imei: step.imei,
          session_id: input.sessionId,
          session_ref: input.sessionRef,
          order_id: input.orderId,
          command_code: step.commandCode,
          start_token: startToken,
          create_dispatch: true,
            request_payload: {
              requested_from: 'runtime_engine',
              command_plan: 'session_start',
              relation_id: input.relation.relationId,
              sequence_mode: sequence,
              step_no: index + 1,
              role: step.role,
              delay_seconds: step.delaySeconds,
              integrated_control: false,
              control_route: step.route,
              target_roles: [step.role]
            },
            source: 'runtime_engine'
          },
        input.client
      );
      queuedCommands.push({
        step_no: index + 1,
        role: step.role,
        delay_seconds: step.delaySeconds,
        ...queued.command
      });
    }

    return {
      startToken,
      sequence,
      queued_commands: queuedCommands
    };
  }

  private async queueSessionStopCommands(input: {
    sessionId: string;
    sessionRef: string | null;
    orderId?: string | null;
    relation: Record<string, any>;
    roles?: Array<'pump' | 'valve'>;
    client: PoolClient;
  }) {
    const targets = await this.runtimeRepository.findSessionControlTargets(
      {
        wellId: input.relation.wellId,
        pumpId: input.relation.pumpId,
        valveId: input.relation.valveId
      },
      input.client
    );

    if (!targets) {
      return {
        stopToken: null,
        queued_commands: []
      };
    }

    const stopToken = `stop-${input.sessionId.slice(0, 8)}`;
    const pumpRoute = this.resolveSessionControlRoute('pump', targets);
    const valveRoute = this.resolveSessionControlRoute('valve', targets);
    const roleFilter = new Set(
      (Array.isArray(input.roles) && input.roles.length > 0 ? input.roles : ['valve', 'pump']).map((item) =>
        this.asString(item).toLowerCase()
      )
    );
    const steps = [
      {
        role: 'valve' as const,
        deviceId: valveRoute.deviceId,
        imei: valveRoute.imei,
        commandCode: 'CLOSE_VALVE',
        delaySeconds: 0,
        route: valveRoute.route
      },
      {
        role: 'pump' as const,
        deviceId: pumpRoute.deviceId,
        imei: pumpRoute.imei,
        commandCode: 'STOP_PUMP',
        delaySeconds: 3,
        route: pumpRoute.route
      }
    ].filter((step) => roleFilter.has(step.role));

    const queuedCommands: Array<Record<string, unknown>> = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (!step.deviceId || !step.imei) continue;
      const queued = await this.deviceGatewayService.queueCommand(
        {
          target_device_id: step.deviceId,
          imei: step.imei,
          session_id: input.sessionId,
          session_ref: input.sessionRef,
          order_id: input.orderId ?? null,
          command_code: step.commandCode,
          start_token: stopToken,
          create_dispatch: true,
            request_payload: {
              requested_from: 'runtime_engine',
              command_plan: 'session_stop',
              relation_id: input.relation.relationId,
              step_no: index + 1,
              role: step.role,
              delay_seconds: step.delaySeconds,
              integrated_control: false,
              control_route: step.route,
              target_roles: [step.role]
            },
            source: 'runtime_engine'
          },
        input.client
      );
      queuedCommands.push({
        step_no: index + 1,
        role: step.role,
        delay_seconds: step.delaySeconds,
        ...queued.command
      });
    }

    return {
      stopToken,
      queued_commands: queuedCommands
    };
  }

  private async queueSessionPauseCommands(input: {
    sessionId: string;
    sessionRef: string | null;
    orderId: string;
    relation: Record<string, any>;
    client: PoolClient;
  }) {
    const targets = await this.runtimeRepository.findSessionControlTargets(
      {
        wellId: input.relation.wellId,
        pumpId: input.relation.pumpId,
        valveId: input.relation.valveId
      },
      input.client
    );

    if (!targets?.wellDeviceId || !targets.wellImei) {
      return {
        pauseToken: null,
        queued_commands: []
      };
    }

    const pauseToken = `pause-${input.sessionId.slice(0, 8)}`;
    const queued = await this.deviceGatewayService.queueCommand(
      {
        target_device_id: targets.wellDeviceId,
        imei: targets.wellImei,
        session_id: input.sessionId,
        session_ref: input.sessionRef,
        order_id: input.orderId,
        command_code: 'EXECUTE_ACTION',
        start_token: pauseToken,
        create_dispatch: true,
        request_payload: {
          requested_from: 'runtime_engine',
          command_plan: 'session_pause',
          relation_id: input.relation.relationId,
          session_id: input.sessionId,
          session_ref: input.sessionRef,
          scope: 'workflow',
          action_code: 'pause_session',
          module_code: null,
          module_instance_code: null,
          channel_code: null,
          target_ref: input.sessionRef
        },
        source: 'runtime_engine'
      },
      input.client
    );

    return {
      pauseToken,
      queued_commands: [
        {
          role: 'well_workflow',
          step_no: 1,
          delay_seconds: 0,
          ...queued.command
        }
      ]
    };
  }

  private async queueSessionResumeCommands(input: {
    sessionId: string;
    sessionRef: string | null;
    orderId: string;
    relation: Record<string, any>;
    client: PoolClient;
  }) {
    const targets = await this.runtimeRepository.findSessionControlTargets(
      {
        wellId: input.relation.wellId,
        pumpId: input.relation.pumpId,
        valveId: input.relation.valveId
      },
      input.client
    );

    if (!targets?.wellDeviceId || !targets.wellImei) {
      return {
        resumeToken: null,
        queued_commands: []
      };
    }

    const resumeToken = `resume-${input.sessionId.slice(0, 8)}`;
    const queued = await this.deviceGatewayService.queueCommand(
      {
        target_device_id: targets.wellDeviceId,
        imei: targets.wellImei,
        session_id: input.sessionId,
        session_ref: input.sessionRef,
        order_id: input.orderId,
        command_code: 'EXECUTE_ACTION',
        start_token: resumeToken,
        create_dispatch: true,
        request_payload: {
          requested_from: 'runtime_engine',
          command_plan: 'session_resume',
          relation_id: input.relation.relationId,
          session_id: input.sessionId,
          session_ref: input.sessionRef,
          scope: 'workflow',
          action_code: 'resume_session',
          module_code: null,
          module_instance_code: null,
          channel_code: null,
          target_ref: input.sessionRef
        },
        source: 'runtime_engine'
      },
      input.client
    );

    return {
      resumeToken,
      queued_commands: [
        {
          role: 'well_workflow',
          step_no: 1,
          delay_seconds: 0,
          ...queued.command
        }
      ]
    };
  }

  async createSession(decisionId: string, cardToken?: string | null, options?: CreateSessionOptions) {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser(cardToken);

    return this.runtimeRepository.withTransaction(async (client) => {
      const decision = await this.runtimeRepository.findDecisionById(decisionId, client, true);
      if (!decision) {
        throw new AppException(ErrorCodes.DECISION_NOT_FOUND, 'Runtime decision not found', 404, {
          decisionId,
          status: 'not_found'
        });
      }

      if (decision.userId !== runtimeUser.id) {
        throw new AppException(ErrorCodes.DATA_SCOPE_DENIED, 'Runtime decision is not visible to current user', 403, {
          decisionId,
          status: 'forbidden'
        });
      }

      if (decision.decisionResult !== 'allow') {
        throw new AppException(ErrorCodes.DECISION_NOT_ALLOWED, 'Runtime decision is not allowed', 400, {
          decisionId,
          status: 'rejected'
        });
      }

      const expiresAt = new Date(decision.decisionExpiresAt);
      if (expiresAt.getTime() < Date.now()) {
        throw new AppException(ErrorCodes.DECISION_EXPIRED, 'Runtime decision has expired', 400, {
          decisionId,
          status: 'expired'
        });
      }

      const existingSession = await this.runtimeRepository.findSessionByDecisionId(decisionId, client);
      if (existingSession) {
        throw new AppException(ErrorCodes.DECISION_ALREADY_CONSUMED, 'Runtime decision has already created a session', 200, {
          sessionId: existingSession.id,
          sessionNo: existingSession.sessionNo,
          status: existingSession.status,
          idempotent: true
        });
      }

      const guard = await this.runtimeDecisionService.evaluateStartEligibility(
        {
          targetType: decision.targetType,
          targetId: decision.targetId,
          sceneCode: decision.sceneCode,
          relationId:
            this.asString(this.asObject((decision.effectiveRuleSnapshot as Record<string, unknown>).resolved_from).relationId) ||
            this.asString(this.asObject((decision.effectiveRuleSnapshot as Record<string, unknown>).relation).relationId) ||
            null
        },
        runtimeUser.id,
        runtimeUser.tenantId,
        cardToken,
        client
      );

      if (guard.result !== 'allow') {
        throw new AppException((guard.blockingReasons[0]?.code as any) ?? ErrorCodes.FORBIDDEN, guard.blockingReasons[0]?.message ?? 'Runtime session cannot be created', 400, {
          decisionId,
          result: guard.result,
          blockingReasons: guard.blockingReasons,
          availableActions: guard.availableActions,
          pricePreview: guard.pricePreview
        });
      }

      const snapshot = guard.effectiveRuleSnapshot as Record<string, any>;
      const relation = snapshot.relation;
      const billing = snapshot.billing;
      if (!relation || !billing) {
        throw new AppException(ErrorCodes.POLICY_NOT_EFFECTIVE, 'Runtime decision is missing effective policy data');
      }

      const sessionRef = `SIM-${Date.now()}`;
      const orderChannel = options?.orderChannel ?? (cardToken?.trim() ? 'CARD' : 'QR');
      const fundingMode = options?.fundingMode ?? (cardToken?.trim() ? 'card_wallet' : 'qr_postpaid');

      const session = await this.runtimeRepository.createRuntimeSession(
        {
          tenantId: decision.tenantId,
          userId: decision.userId,
          wellId: relation.wellId,
          pumpId: relation.pumpId,
          valveId: relation.valveId,
          sessionRef,
          sourceDecisionId: decision.id,
          telemetrySnapshot: {
            startedBy: 'phase-1-runtime',
            traceId: randomUUID(),
            sessionRef,
            orderChannel,
            fundingMode,
            effectiveRuleSnapshot: guard.effectiveRuleSnapshot,
            pricePreview: guard.pricePreview
          }
        },
        client
      );

      if (!session.created) {
        throw new AppException(ErrorCodes.DECISION_ALREADY_CONSUMED, 'Runtime decision has already created a session', 200, {
          sessionId: session.id,
          sessionNo: session.sessionNo,
          status: session.status,
          idempotent: true
        });
      }

      const pricingSnapshot = {
        mode: billing.billingMode,
        unitPrice: billing.unitPrice,
        unitType: billing.unitType,
        minChargeAmount: billing.minChargeAmount,
        pricingRules: billing.pricingRules ?? {},
        effectiveRuleSnapshot: guard.effectiveRuleSnapshot,
        preview: guard.pricePreview,
        breakdown: []
      };

      const order = await this.orderRepository.createDraft(
        {
          tenantId: decision.tenantId,
          sessionId: session.id,
          userId: decision.userId,
          billingPackageId: billing.billingPackageId,
          pricingSnapshot,
          pricingDetail: this.buildDraftPricingDetail(pricingSnapshot, guard.effectiveRuleSnapshot, guard.pricePreview),
          orderChannel,
          fundingMode
        },
        client
      );

      await this.orderSettlementService.attachCheckoutContextToOrder(client, {
        orderId: order.id,
        targetDeviceId: options?.targetDeviceId ?? null,
        targetImei: options?.targetImei ?? null,
        targetDeviceRole: options?.targetDeviceRole ?? null,
        paymentMode: options?.paymentMode ?? null,
        paymentStatus: options?.paymentStatus ?? null,
        prepaidAmount: options?.prepaidAmount ?? null,
        lockedAmount: options?.lockedAmount ?? null,
        sourcePaymentIntentId: options?.sourcePaymentIntentId ?? null,
        checkoutSnapshot: {
          funding_mode: fundingMode,
          order_channel: orderChannel,
          started_via: options?.startedVia ?? (cardToken?.trim() ? 'card_swipe' : 'qr_payment'),
          ...(options?.checkoutSnapshot ?? {})
        }
      });

      await this.orderSettlementService.captureStartSnapshot(session.id, client);

      if (!order.created) {
        throw new AppException(ErrorCodes.ORDER_ALREADY_EXISTS, 'Runtime session already has an irrigation order', 200, {
          sessionId: session.id,
          orderId: order.id,
          orderNo: order.orderNo,
          status: session.status,
          idempotent: true
        });
      }

      const queuedStartCommands = await this.queueSessionStartCommands({
        sessionId: session.id,
        sessionRef,
        orderId: order.id,
        relation,
        client
      });

      await this.sessionStatusLogRepository.create(
        {
          tenantId: decision.tenantId,
          sessionId: session.id,
          fromStatus: 'created',
          toStatus: 'pending_start',
          actionCode: 'create_session',
          reasonCode: 'DECISION_ALLOW',
          reasonText: 'runtime decision passed and session entered pending start state',
          source: 'runtime_engine',
          actorId: decision.userId,
          snapshot: {
            decisionId,
            pricePreview: guard.pricePreview,
            effectiveRuleSource: snapshot.resolved_from ?? {},
            sessionRef,
            queuedStartCommands
          }
        },
        client
      );

      return {
        sessionId: session.id,
        status: session.status,
        sessionNo: session.sessionNo,
        sessionRef,
        queuedCommands: queuedStartCommands.queued_commands
      };
    });
  }

  async createSessionSynchronously(decisionId: string, cardToken?: string | null, options?: CreateSessionOptions) {
    return this.confirmStartSynchronously(await this.createSession(decisionId, cardToken, options));
  }

  async createSessionFromWellIdentifier(wellIdentifier: string, cardToken?: string | null) {
    const decision = await this.createStartDecisionForWellIdentifier(wellIdentifier, cardToken);

    if (decision.result !== 'allow') {
      throw new AppException(
        (decision.blockingReasons[0]?.code as any) ?? ErrorCodes.DECISION_NOT_ALLOWED,
        decision.blockingReasons[0]?.message ?? 'Runtime decision is not allowed',
        400,
        {
          result: decision.result,
          decisionId: decision.decisionId,
          blockingReasons: decision.blockingReasons,
          availableActions: decision.availableActions,
          pricePreview: decision.pricePreview
        }
      );
    }

    return this.createSession(decision.decisionId, cardToken);
  }

  async createSessionFromWellIdentifierSynchronously(wellIdentifier: string, cardToken?: string | null) {
    const decision = await this.createStartDecisionForWellIdentifier(wellIdentifier, cardToken);

    if (decision.result !== 'allow') {
      throw new AppException(
        (decision.blockingReasons[0]?.code as any) ?? ErrorCodes.DECISION_NOT_ALLOWED,
        decision.blockingReasons[0]?.message ?? 'Runtime decision is not allowed',
        400,
        {
          result: decision.result,
          decisionId: decision.decisionId,
          blockingReasons: decision.blockingReasons,
          availableActions: decision.availableActions,
          pricePreview: decision.pricePreview
        }
      );
    }

    return this.createSessionSynchronously(decision.decisionId, cardToken);
  }
  async sendTestCommand(deviceIdentifier: string, action: string) {
    const device = await this.runtimeRepository.findDeviceByIdentifier(deviceIdentifier);
    if (!device) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Target device was not found', 404, {
        targetId: deviceIdentifier
      });
    }

    return this.deviceGatewayService.queueCommand({
      target_device_id: device.id,
      imei: device.imei ?? undefined,
      command_code: action,
      request_payload: {
        requested_from: 'manual_test',
        requested_action: action,
        target_device_code: device.deviceCode
      },
      source: 'manual_test'
    });
  }

  async createStartDecisionForWellIdentifier(wellIdentifier: string, cardToken?: string | null) {
    const resolvedWellId = await this.runtimeRepository.findWellIdByIdentifier(wellIdentifier);
    if (!resolvedWellId) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Target well was not found', 404, {
        targetId: wellIdentifier
      });
    }

    return this.runtimeDecisionService.createStartDecision(
      {
        targetType: 'well',
        targetId: resolvedWellId,
        sceneCode: 'farmer_scan_start'
      },
      { cardToken }
    );
  }

  async getCurrentSession(cardToken?: string | null) {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser(cardToken);
    const session = await this.runtimeRepository.findCurrentSessionByUserId(runtimeUser.id);
    if (!session) {
      return null;
    }

    const progress = await this.orderSettlementService.syncProgressBySessionId(session.id).catch(() => null);
    const liveProgress = progress && !('skipped' in progress) ? progress : null;

    const durationSeconds =
      liveProgress?.usage.durationSec ??
      session.chargeDurationSec ??
      (session.startedAt
        ? Math.max(
            1,
            Math.ceil((Date.now() - new Date(session.startedAt).getTime()) / 1000)
          )
        : 0);

    const pricingDetail = ((liveProgress?.pricingDetail ?? session.pricingDetail) ?? {}) as Record<string, any>;
    const unit = String(pricingDetail.unit ?? session.unitType ?? 'minute');
    const usage =
      liveProgress?.usage.waterVolumeM3 ??
      session.chargeVolume ??
      Number(pricingDetail.usage?.water_volume_m3 ?? pricingDetail.usage?.volume ?? pricingDetail.usage?.duration_seconds ?? 0);
    const currentAmount = liveProgress?.amount ?? Number(session.amount ?? 0);
    const pumpHealth = (pricingDetail.pump_health?.summary ?? null) as Record<string, unknown> | null;
    const runtimeShadow = session.targetDeviceId
      ? await this.runtimeIngestRepository.findRuntimeShadowByDeviceId(runtimeUser.tenantId, session.targetDeviceId).catch(() => null)
      : this.asString(session.targetImei)
        ? await this.runtimeIngestRepository.findRuntimeShadowByImei(runtimeUser.tenantId, this.asString(session.targetImei)).catch(() => null)
        : null;
    const recentGatewayCommands =
      session.targetDeviceId || this.asString(session.targetImei)
        ? await this.deviceGatewayService
            .listCommands({
              target_device_id: session.targetDeviceId ?? undefined,
              imei: this.asString(session.targetImei) || undefined,
              command_code: 'QUERY',
              limit: 20
            })
            .catch(() => [])
        : [];
    const latestQueries = this.resolveLatestDeviceQueries(recentGatewayCommands);
    const queryCommonStatus = this.asObject(latestQueries.commonStatus?.payload.common_status);
    const queryWorkflowState = this.asObject(latestQueries.workflowState?.payload.controller_state);
    const shadowCommonStatus = this.asObject(runtimeShadow?.commonStatus);
    const sessionStatus = this.asString(session.status) || 'running';
    const lifecycleStage = deriveFormalOrderLifecycleStage({
      explicitLifecycle: pricingDetail.lifecycle_stage,
      orderStatus: session.settlementStatus === 'settled' ? 'settled' : 'created',
      sessionStatus,
      pricingDetail
    });
    const deviceRuntime = session.targetDeviceId || this.asString(session.targetImei)
      ? {
          device_id: session.targetDeviceId ?? runtimeShadow?.deviceId ?? null,
          imei: session.targetImei ?? runtimeShadow?.imei ?? null,
          device_name: session.targetDeviceName ?? null,
          device_role: session.targetDeviceRole ?? null,
          connection_state: runtimeShadow?.connectionState ?? null,
          online_state: runtimeShadow?.onlineState ?? null,
          workflow_state:
            this.asString(queryWorkflowState.workflow_state ?? queryWorkflowState.workflowState) ||
            runtimeShadow?.workflowState ||
            null,
          ready:
            this.asBoolean(queryCommonStatus.ready) ??
            this.asBoolean(shadowCommonStatus.ready) ??
            runtimeShadow?.ready ??
            null,
          config_version:
            this.asNumber(queryCommonStatus.config_version ?? queryCommonStatus.configVersion) ??
            runtimeShadow?.configVersion ??
            null,
          signal_csq:
            this.asNumber(queryCommonStatus.signal_csq ?? queryCommonStatus.signalCsq) ??
            runtimeShadow?.signalCsq ??
            null,
          battery_soc:
            this.asNumber(queryCommonStatus.battery_soc ?? queryCommonStatus.batterySoc) ??
            runtimeShadow?.batterySoc ??
            null,
          battery_voltage: runtimeShadow?.batteryVoltage ?? null,
          solar_voltage: runtimeShadow?.solarVoltage ?? null,
          active_session_id:
            this.asString(queryWorkflowState.active_session_id ?? queryWorkflowState.activeSessionId) || null,
          active_session_started_at_utc:
            this.asNumber(
              queryWorkflowState.active_session_started_at_utc ??
                queryWorkflowState.activeSessionStartedAtUtc
            ) ?? null,
          stop_guard_remaining_ms:
            this.asNumber(
              queryWorkflowState.stop_guard_remaining_ms ?? queryWorkflowState.stopGuardRemainingMs
            ) ?? null,
          recovery_pending:
            this.asBoolean(queryWorkflowState.recovery_pending ?? queryWorkflowState.recoveryPending) ?? null,
          settlement_pending:
            this.asBoolean(queryWorkflowState.settlement_pending ?? queryWorkflowState.settlementPending) ?? null,
          last_recovery_hint:
            this.asString(queryWorkflowState.last_recovery_hint ?? queryWorkflowState.lastRecoveryHint) || null,
          last_stop_reason_code:
            this.asNumber(queryWorkflowState.last_stop_reason_code ?? queryWorkflowState.lastStopReasonCode) ?? null,
          last_stop_at_utc:
            this.asNumber(queryWorkflowState.last_stop_at_utc ?? queryWorkflowState.lastStopAtUtc) ?? null,
          last_heartbeat_at: runtimeShadow?.lastHeartbeatAt ?? null,
          last_event_at: runtimeShadow?.lastEventAt ?? null,
          updated_at:
            latestQueries.workflowState?.updatedAt ??
            latestQueries.commonStatus?.updatedAt ??
            runtimeShadow?.updatedAt ??
            null
        }
      : null;

    return {
      id: session.id,
      session_ref: session.sessionRef ?? null,
      well_name: session.wellDisplayName ?? session.wellCode ?? session.wellId,
      status: sessionStatus,
      lifecycle_stage: lifecycleStage,
      usage: Number(usage ?? 0),
      unit,
      duration_minutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      cost: Number(currentAmount ?? 0),
      billing_package: session.billingPackageName ?? '--',
      unit_price: Number(pricingDetail.unit_price ?? 0),
      payment_mode: session.paymentMode ?? null,
      payment_status: session.paymentStatus ?? null,
      prepaid_amount: Number(pricingDetail.credit_limit_amount ?? 0),
      refundable_amount: Math.max(0, Number(pricingDetail.credit_limit_amount ?? 0) - Number(currentAmount ?? 0)),
      awaiting_device_start: sessionStatus === 'pending_start',
      awaiting_device_ack: ['pausing', 'resuming', 'stopping'].includes(session.status),
      pump_health: pumpHealth,
      target_imei: session.targetImei ?? null,
      target_device_role: session.targetDeviceRole ?? null,
      target_device_name: session.targetDeviceName ?? null,
      device_runtime: deviceRuntime
    };
  }

  async listSessions() {
    return this.runtimeRepository.findAllSessions();
  }

  async listCommands() {
    return this.runtimeRepository.findAllCommands();
  }

  async listRuntimeContainers() {
    return this.runtimeRepository.findRuntimeContainers();
  }

  async getSessionObservability(sessionId: string) {
    const session = await this.runtimeRepository.findSessionObservabilityById(sessionId);
    if (!session) {
      throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
        sessionId,
        status: 'not_found'
      });
    }

    const statusLogs = await this.sessionStatusLogRepository.findBySessionId(sessionId);
    const commands = await this.runtimeRepository.findCommandsBySessionId(sessionId);

    return {
      session: {
        id: session.id,
        session_no: session.sessionNo,
        status: session.status,
        user: session.userDisplayName ?? session.userId,
        well: session.wellDisplayName ?? session.wellCode ?? session.wellId,
        started_at: session.startedAt,
        ended_at: session.endedAt,
        runtime_container_id: session.runtimeContainerId,
        telemetry_snapshot: session.telemetrySnapshot ?? {}
      },
      order: session.orderId
        ? {
            id: session.orderId,
            order_no: session.orderNo,
            status: session.orderStatus,
            settlement_status: session.settlementStatus,
            amount: Number(session.amount ?? 0),
            charge_duration_sec: Number(session.chargeDurationSec ?? 0),
            charge_volume: Number(session.chargeVolume ?? 0),
            pricing_detail: session.pricingDetail ?? {}
          }
        : null,
      commands,
      status_logs: statusLogs
    };
  }

  private async requestSessionStopInternal(input: {
    session: Awaited<ReturnType<RuntimeRepository['findSessionById']>>;
    order: Record<string, any>;
    client: PoolClient;
    actorId: string | null;
    source: 'manual' | 'system' | 'runtime_engine';
    reasonCode: string;
    reasonText: string;
    endReasonCode: string;
    snapshot?: Record<string, unknown>;
  }) {
    const session = input.session;
    if (!session) {
      throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404);
    }

    if (session.status === 'ended' || session.endedAt) {
      throw new AppException(ErrorCodes.SESSION_ALREADY_ENDED, 'Runtime session has already ended', 200, {
        sessionId: session.id,
        status: 'ended',
        idempotent: true,
        order: this.buildFarmerStopOrderSnapshot(input.order)
      });
    }

    const stopRequestedAt = new Date().toISOString();

    if (session.status === 'stopping') {
      const frozenProgress = await this.orderSettlementService.freezeProgressAtStopRequest(session.id, input.client, {
        frozenAt: stopRequestedAt,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        source: input.source
      });
      return {
        sessionId: session.id,
        status: session.status,
        order: this.buildFarmerStopOrderSnapshot({
          ...input.order,
          amount: frozenProgress?.amount ?? input.order.amount,
          pricingDetail: frozenProgress?.pricingDetail ?? input.order.pricingDetail
        }),
        sessionRef: session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`,
        queuedCommands: [],
        awaitingDeviceAck: true,
        idempotent: true
      };
    }

    if (!['pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping'].includes(session.status)) {
      throw new AppException(ErrorCodes.SESSION_NOT_STOPPABLE, 'Runtime session is not in a stoppable state', 400, {
        sessionId: session.id,
        status: session.status
      });
    }

    const sessionRef = session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`;
    const queuedStopCommands = await this.queueSessionStopCommands({
      sessionId: session.id,
      sessionRef,
      orderId: input.order.id,
      relation: {
        relationId: null,
        wellId: session.wellId,
        pumpId: session.pumpId,
        valveId: session.valveId
      },
      client: input.client
    });

    await this.sessionStatusLogRepository.create(
      {
        tenantId: session.tenantId,
        sessionId: session.id,
        fromStatus: session.status,
        toStatus: 'stopping',
        actionCode: 'stop_session_requested',
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        source: input.source,
        actorId: input.actorId,
        snapshot: {
          currentOrderStatus: input.order.status,
          sessionRef,
          queuedStopCommands,
          ...(input.snapshot ?? {})
        }
      },
      input.client
    );

    const stopped = await this.runtimeRepository.stopSession(session.id, input.client, input.endReasonCode);
    if (!stopped) {
      throw new AppException(ErrorCodes.SESSION_NOT_STOPPABLE, 'Runtime session could not be stopped', 400, {
        sessionId: session.id
      });
    }

    const frozenProgress = await this.orderSettlementService.freezeProgressAtStopRequest(session.id, input.client, {
      frozenAt: stopRequestedAt,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      source: input.source
    });

    return {
      sessionId: stopped.id,
      status: stopped.status,
      order: this.buildFarmerStopOrderSnapshot({
        ...input.order,
        amount: frozenProgress?.amount ?? input.order.amount,
        pricingDetail: frozenProgress?.pricingDetail ?? input.order.pricingDetail
      }),
      sessionRef,
      queuedCommands: queuedStopCommands.queued_commands,
      awaitingDeviceAck: true
    };
  }

  private async requestSessionPauseInternal(input: {
    session: Awaited<ReturnType<RuntimeRepository['findSessionById']>>;
    order: Record<string, any>;
    client: PoolClient;
    actorId: string | null;
    source: 'manual' | 'system' | 'runtime_engine';
    reasonCode: string;
    reasonText: string;
    snapshot?: Record<string, unknown>;
  }) {
    const session = input.session;
    if (!session) {
      throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404);
    }

    if (session.status === 'ended' || session.endedAt) {
      throw new AppException(ErrorCodes.SESSION_ALREADY_ENDED, 'Runtime session has already ended', 200, {
        sessionId: session.id,
        status: 'ended',
        idempotent: true,
        order: this.buildFarmerStopOrderSnapshot(input.order)
      });
    }

    if (session.status === 'paused') {
      return {
        sessionId: session.id,
        status: session.status,
        order: this.buildFarmerStopOrderSnapshot(input.order),
        sessionRef: session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`,
        queuedCommands: [],
        awaitingDeviceAck: false,
        idempotent: true
      };
    }

    if (session.status === 'pausing') {
      return {
        sessionId: session.id,
        status: session.status,
        order: this.buildFarmerStopOrderSnapshot(input.order),
        sessionRef: session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`,
        queuedCommands: [],
        awaitingDeviceAck: true,
        idempotent: true
      };
    }

    if (!['running', 'billing'].includes(session.status)) {
      throw new AppException(ErrorCodes.SESSION_NOT_PAUSABLE, 'Runtime session is not in a pausable state', 400, {
        sessionId: session.id,
        status: session.status
      });
    }

    const sessionRef = session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`;
    const queuedPauseCommands = await this.queueSessionPauseCommands({
      sessionId: session.id,
      sessionRef,
      orderId: input.order.id,
      relation: {
        relationId: null,
        wellId: session.wellId,
        pumpId: session.pumpId,
        valveId: session.valveId
      },
      client: input.client
    });
    if ((queuedPauseCommands.queued_commands ?? []).length === 0) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, 'pause failed because no pause command was generated', 500, {
        sessionId: session.id
      });
    }

    const pausedAt = new Date().toISOString();
    await input.client.query(
      `
      update runtime_session
      set status = 'pausing',
          updated_at = now()
      where id = $1::uuid
        and status in ('running', 'billing')
      `,
      [session.id]
    );

    await this.orderSettlementService.freezeProgressAtPauseRequest(session.id, input.client, {
      frozenAt: pausedAt,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      source: input.source
    });

    await this.sessionStatusLogRepository.create(
      {
        tenantId: session.tenantId,
        sessionId: session.id,
        fromStatus: session.status,
        toStatus: 'pausing',
        actionCode: 'pause_session_requested',
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        source: input.source,
        actorId: input.actorId,
        snapshot: {
          currentOrderStatus: input.order.status,
          sessionRef,
          queuedPauseCommands,
          ...(input.snapshot ?? {})
        }
      },
      input.client
    );

    return {
      sessionId: session.id,
      status: 'pausing',
      order: this.buildFarmerStopOrderSnapshot(input.order),
      sessionRef,
      queuedCommands: queuedPauseCommands.queued_commands,
      awaitingDeviceAck: true
    };
  }

  private async requestSessionResumeInternal(input: {
    session: Awaited<ReturnType<RuntimeRepository['findSessionById']>>;
    order: Record<string, any>;
    client: PoolClient;
    actorId: string | null;
    source: 'manual' | 'system' | 'runtime_engine';
    reasonCode: string;
    reasonText: string;
    snapshot?: Record<string, unknown>;
  }) {
    const session = input.session;
    if (!session) {
      throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404);
    }

    if (session.status === 'ended' || session.endedAt) {
      throw new AppException(ErrorCodes.SESSION_ALREADY_ENDED, 'Runtime session has already ended', 200, {
        sessionId: session.id,
        status: 'ended',
        idempotent: true,
        order: this.buildFarmerStopOrderSnapshot(input.order)
      });
    }

    if (session.status === 'running' || session.status === 'billing') {
      return {
        sessionId: session.id,
        status: session.status,
        order: this.buildFarmerStopOrderSnapshot(input.order),
        sessionRef: session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`,
        queuedCommands: [],
        awaitingDeviceAck: false,
        idempotent: true
      };
    }

    if (session.status === 'resuming') {
      return {
        sessionId: session.id,
        status: session.status,
        order: this.buildFarmerStopOrderSnapshot(input.order),
        sessionRef: session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`,
        queuedCommands: [],
        awaitingDeviceAck: true,
        idempotent: true
      };
    }

    if (session.status !== 'paused') {
      throw new AppException(ErrorCodes.SESSION_NOT_RESUMABLE, 'Runtime session is not in a resumable state', 400, {
        sessionId: session.id,
        status: session.status
      });
    }

    const sessionRef = session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`;
    const queuedResumeCommands = await this.queueSessionResumeCommands({
      sessionId: session.id,
      sessionRef,
      orderId: input.order.id,
      relation: {
        relationId: null,
        wellId: session.wellId,
        pumpId: session.pumpId,
        valveId: session.valveId
      },
      client: input.client
    });
    if ((queuedResumeCommands.queued_commands ?? []).length === 0) {
      throw new AppException(ErrorCodes.INTERNAL_ERROR, 'resume failed because no resume command was generated', 500, {
        sessionId: session.id
      });
    }

    const resumeRequestedAt = new Date().toISOString();
    await input.client.query(
      `
      update runtime_session
      set status = 'resuming',
          updated_at = now()
      where id = $1::uuid
        and status = 'paused'
      `,
      [session.id]
    );

    await this.orderSettlementService.markResumeRequested(session.id, input.client, {
      resumeRequestedAt,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      source: input.source
    });

    await this.sessionStatusLogRepository.create(
      {
        tenantId: session.tenantId,
        sessionId: session.id,
        fromStatus: session.status,
        toStatus: 'resuming',
        actionCode: 'resume_session_requested',
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        source: input.source,
        actorId: input.actorId,
        snapshot: {
          currentOrderStatus: input.order.status,
          sessionRef,
          queuedResumeCommands,
          ...(input.snapshot ?? {})
        }
      },
      input.client
    );

    return {
      sessionId: session.id,
      status: 'resuming',
      order: this.buildFarmerStopOrderSnapshot(input.order),
      sessionRef,
      queuedCommands: queuedResumeCommands.queued_commands,
      awaitingDeviceAck: true
    };
  }

  async stopSession(sessionId: string, cardToken?: string | null) {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser(cardToken);

    return this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(sessionId, client, true);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId,
          status: 'not_found'
        });
      }

      if (session.userId !== runtimeUser.id) {
        throw new AppException(ErrorCodes.SESSION_NOT_VISIBLE, 'Runtime session is not visible to current user', 403, {
          sessionId,
          status: 'forbidden'
        });
      }

      const order = await this.orderRepository.findBySessionId(sessionId, client);
      if (!order) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Draft order not found for runtime session', 404, {
          sessionId
        });
      }

      this.assertManualControlCardAuthority(order, cardToken ?? null, sessionId, 'stop');

      return this.requestSessionStopInternal({
        session,
        order,
        client,
        actorId: runtimeUser.id,
        source: 'manual',
        reasonCode: 'MANUAL_STOP',
        reasonText: 'stop request accepted and waiting for device acknowledgement',
        endReasonCode: 'manual_stop_requested'
      });
    });
  }

  async pauseSession(sessionId: string, cardToken?: string | null) {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser(cardToken);

    const requested = await this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(sessionId, client, true);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId,
          status: 'not_found'
        });
      }

      if (session.userId !== runtimeUser.id) {
        throw new AppException(ErrorCodes.SESSION_NOT_VISIBLE, 'Runtime session is not visible to current user', 403, {
          sessionId,
          status: 'forbidden'
        });
      }

      const order = await this.orderRepository.findBySessionId(sessionId, client);
      if (!order) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Draft order not found for runtime session', 404, {
          sessionId
        });
      }

      this.assertManualControlCardAuthority(order, cardToken ?? null, sessionId, 'pause');

      return this.requestSessionPauseInternal({
        session,
        order,
        client,
        actorId: runtimeUser.id,
        source: 'manual',
        reasonCode: 'MANUAL_PAUSE',
        reasonText: 'pause request accepted and waiting for device acknowledgement'
      });
    });

    if (requested.status !== 'pausing') {
      return requested;
    }

    return this.confirmSessionControlSynchronously({
      sessionId: requested.sessionId,
      queuedCommands: requested.queuedCommands,
      expectedPendingStatus: 'pausing',
      successStatuses: ['paused'],
      restoreStatus: 'running',
      timeoutErrorCode: ErrorCodes.STARTUP_TIMEOUT,
      timeoutMessage: 'pause timed out and was rolled back',
      mode: 'pause'
    });
  }

  async resumeSession(sessionId: string, cardToken?: string | null) {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser(cardToken);

    const requested = await this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(sessionId, client, true);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId,
          status: 'not_found'
        });
      }

      if (session.userId !== runtimeUser.id) {
        throw new AppException(ErrorCodes.SESSION_NOT_VISIBLE, 'Runtime session is not visible to current user', 403, {
          sessionId,
          status: 'forbidden'
        });
      }

      const order = await this.orderRepository.findBySessionId(sessionId, client);
      if (!order) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Draft order not found for runtime session', 404, {
          sessionId
        });
      }

      this.assertManualControlCardAuthority(order, cardToken ?? null, sessionId, 'resume');

      return this.requestSessionResumeInternal({
        session,
        order,
        client,
        actorId: runtimeUser.id,
        source: 'manual',
        reasonCode: 'MANUAL_RESUME',
        reasonText: 'resume request accepted and waiting for device acknowledgement'
      });
    });

    if (requested.status !== 'resuming') {
      return requested;
    }

    return this.confirmSessionControlSynchronously({
      sessionId: requested.sessionId,
      queuedCommands: requested.queuedCommands,
      expectedPendingStatus: 'resuming',
      successStatuses: ['running', 'billing'],
      restoreStatus: 'paused',
      timeoutErrorCode: ErrorCodes.STARTUP_TIMEOUT,
      timeoutMessage: 'resume timed out and remained paused',
      mode: 'resume'
    });
  }

  async stopSessionBySystem(
    sessionId: string,
    options?: {
      reasonCode?: string;
      reasonText?: string;
      endReasonCode?: string;
      snapshot?: Record<string, unknown>;
    }
  ) {
    return this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(sessionId, client, true);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId,
          status: 'not_found'
        });
      }

      const order = await this.orderRepository.findBySessionId(sessionId, client);
      if (!order) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Draft order not found for runtime session', 404, {
          sessionId
        });
      }

      return this.requestSessionStopInternal({
        session,
        order,
        client,
        actorId: null,
        source: 'system',
        reasonCode: options?.reasonCode ?? 'CREDIT_LIMIT_REACHED',
        reasonText:
          options?.reasonText ?? 'credit limit reached and stop request accepted, waiting for device acknowledgement',
        endReasonCode: options?.endReasonCode ?? 'credit_limit_reached_auto_stop_requested',
        snapshot: options?.snapshot
      });
    });
  }

  async pauseSessionBySystem(
    sessionId: string,
    options?: {
      reasonCode?: string;
      reasonText?: string;
      snapshot?: Record<string, unknown>;
    }
  ) {
    const requested = await this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(sessionId, client, true);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId,
          status: 'not_found'
        });
      }

      const order = await this.orderRepository.findBySessionId(sessionId, client);
      if (!order) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Draft order not found for runtime session', 404, {
          sessionId
        });
      }

      return this.requestSessionPauseInternal({
        session,
        order,
        client,
        actorId: null,
        source: 'system',
        reasonCode: options?.reasonCode ?? 'SYSTEM_AUTO_PAUSE',
        reasonText: options?.reasonText ?? 'system pause request accepted and waiting for device acknowledgement',
        snapshot: options?.snapshot
      });
    });

    if (requested.status !== 'pausing') {
      return requested;
    }

    return this.confirmSessionControlSynchronously({
      sessionId: requested.sessionId,
      queuedCommands: requested.queuedCommands,
      expectedPendingStatus: 'pausing',
      successStatuses: ['paused'],
      restoreStatus: 'running',
      timeoutErrorCode: ErrorCodes.STARTUP_TIMEOUT,
      timeoutMessage: 'pause timed out and was rolled back',
      mode: 'pause'
    });
  }

  async resumeSessionBySystem(
    sessionId: string,
    options?: {
      reasonCode?: string;
      reasonText?: string;
      snapshot?: Record<string, unknown>;
    }
  ) {
    const requested = await this.runtimeRepository.withTransaction(async (client) => {
      const session = await this.runtimeRepository.findSessionById(sessionId, client, true);
      if (!session) {
        throw new AppException(ErrorCodes.SESSION_NOT_FOUND, 'Runtime session not found', 404, {
          sessionId,
          status: 'not_found'
        });
      }

      const order = await this.orderRepository.findBySessionId(sessionId, client);
      if (!order) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Draft order not found for runtime session', 404, {
          sessionId
        });
      }

      return this.requestSessionResumeInternal({
        session,
        order,
        client,
        actorId: null,
        source: 'system',
        reasonCode: options?.reasonCode ?? 'SYSTEM_AUTO_RESUME',
        reasonText: options?.reasonText ?? 'system resume request accepted and waiting for device acknowledgement',
        snapshot: options?.snapshot
      });
    });

    if (requested.status !== 'resuming') {
      return requested;
    }

    return this.confirmSessionControlSynchronously({
      sessionId: requested.sessionId,
      queuedCommands: requested.queuedCommands,
      expectedPendingStatus: 'resuming',
      successStatuses: ['running', 'billing'],
      restoreStatus: 'paused',
      timeoutErrorCode: ErrorCodes.STARTUP_TIMEOUT,
      timeoutMessage: 'resume timed out and remained paused',
      mode: 'resume'
    });
  }

  private buildDraftPricingDetail(
    pricingSnapshot: Record<string, any>,
    effectiveRuleSnapshot: Record<string, unknown>,
    pricePreview: RuntimeDecisionContract['pricePreview']
  ) {
    const previewFinalAmount = this.estimatePreviewAmount(
      String(pricingSnapshot.mode ?? 'duration'),
      Number(pricingSnapshot.unitPrice ?? 0),
      Number(pricingSnapshot.minChargeAmount ?? 0)
    );

    return {
      billing_mode: pricingSnapshot.mode,
      unit_price: Number(pricingSnapshot.unitPrice ?? 0),
      min_charge: Number(pricingSnapshot.minChargeAmount ?? 0),
      usage: {
        duration_seconds: 0
      },
      duration_seconds: 0,
      subtotal: previewFinalAmount,
      preview_final_amount: previewFinalAmount,
      final_amount: 0,
      preview_delta_amount: 0,
      price_preview: pricePreview,
      effective_rule_snapshot_ref: {
        resolved_from: (effectiveRuleSnapshot as Record<string, any>).resolved_from ?? {}
      }
    };
  }

  private buildSettledPricingDetail(
    existingPricingDetail: Record<string, any>,
    pricingSnapshot: Record<string, any>,
    durationSec: number,
    finalAmount: number
  ) {
    const previewFinalAmount = Number(existingPricingDetail.preview_final_amount ?? 0);
    return {
      ...existingPricingDetail,
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
      effective_rule_snapshot_ref: {
        resolved_from: pricingSnapshot.effectiveRuleSnapshot?.resolved_from ?? existingPricingDetail.effective_rule_snapshot_ref?.resolved_from ?? {}
      }
    };
  }

  private estimatePreviewAmount(mode: string, unitPrice: number, minChargeAmount: number) {
    if (mode === 'flat') {
      return Math.max(minChargeAmount, unitPrice);
    }
    if (mode === 'free') {
      return 0;
    }
    return Math.max(minChargeAmount, unitPrice > 0 ? unitPrice : minChargeAmount);
  }
}
