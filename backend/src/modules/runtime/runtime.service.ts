import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import {
  AvailableAction,
  BlockingReason,
  RuntimeDecisionContract,
  createAvailableAction,
  createBlockingReason
} from '../../common/contracts/runtime-decision';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { DeviceGatewayService } from '../device-gateway/device-gateway.service';
import { OrderRepository } from '../order/order.repository';
import { EffectivePolicyResolver, FIXED_PRIORITY_CHAIN } from '../policy/effective-policy.resolver';
import { TopologyService } from '../topology/topology.service';
import { FarmerFundRepository } from '../farmer-fund/farmer-fund.repository';
import { RuntimeRepository } from './runtime.repository';
import { SessionStatusLogRepository } from './session-status-log.repository';

@Injectable()
export class RuntimeDecisionService {
  constructor(
    private readonly topologyService: TopologyService,
    private readonly effectivePolicyResolver: EffectivePolicyResolver,
    private readonly runtimeRepository: RuntimeRepository,
    private readonly farmerFundRepository: FarmerFundRepository
  ) {}

  async createStartDecision(
    input: { targetType: 'valve' | 'well' | 'session'; targetId: string; sceneCode?: string },
    options?: { cardToken?: string | null }
  ): Promise<RuntimeDecisionContract> {
    const runtimeUser = await this.getRuntimeUser(options?.cardToken);
    const evaluated = await this.evaluateStartEligibility(
      {
        targetType: input.targetType,
        targetId: input.targetId,
        sceneCode: input.sceneCode ?? 'farmer_scan_start'
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

  async evaluateStartEligibility(
    input: { targetType: 'valve' | 'well' | 'session'; targetId: string; sceneCode: string },
    runtimeUserId: string,
    tenantId: string,
    cardToken?: string | null,
    client?: PoolClient
  ) {
    const topology = await this.topologyService.validateStartTarget(input.targetType, input.targetId);
    const blockingReasons: BlockingReason[] = [...topology.blockingReasons];
    let effectiveRuleSnapshot: Record<string, unknown> = {
      priorityChain: [...FIXED_PRIORITY_CHAIN]
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

        if (cardToken?.trim() && blockingReasons.length === 0) {
          const minAmt = this.estimateMinChargeAmount(
            String(policy.billing.billingMode ?? 'duration'),
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

        effectiveRuleSnapshot = {
          ...policy,
          relation: topology.relation
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
    private readonly deviceGatewayService: DeviceGatewayService
  ) {}

  private resolveStartSequence(relationConfigJson: Record<string, unknown>) {
    const sequence = String(relationConfigJson.sequence ?? 'valve_first').toLowerCase();
    if (sequence === 'simultaneous' || sequence === 'pump_first') return sequence;
    return 'valve_first';
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
    const steps =
      sequence === 'simultaneous'
        ? [
            {
              role: 'well',
              deviceId: targets.wellDeviceId,
              imei: targets.wellImei,
              commandCode: 'START_SESSION',
              delaySeconds: 0
            },
            {
              role: 'pump',
              deviceId: targets.pumpDeviceId,
              imei: targets.pumpImei,
              commandCode: 'START_PUMP',
              delaySeconds: pumpDelaySeconds
            },
            {
              role: 'valve',
              deviceId: targets.valveDeviceId,
              imei: targets.valveImei,
              commandCode: 'OPEN_VALVE',
              delaySeconds: valveDelaySeconds
            }
          ]
        : sequence === 'pump_first'
          ? [
              {
                role: 'well',
                deviceId: targets.wellDeviceId,
                imei: targets.wellImei,
                commandCode: 'START_SESSION',
                delaySeconds: 0
              },
              {
                role: 'pump',
                deviceId: targets.pumpDeviceId,
                imei: targets.pumpImei,
                commandCode: 'START_PUMP',
                delaySeconds: pumpDelaySeconds
              },
              {
                role: 'valve',
                deviceId: targets.valveDeviceId,
                imei: targets.valveImei,
                commandCode: 'OPEN_VALVE',
                delaySeconds: valveDelaySeconds
              }
            ]
          : [
              {
                role: 'well',
                deviceId: targets.wellDeviceId,
                imei: targets.wellImei,
                commandCode: 'START_SESSION',
                delaySeconds: 0
              },
              {
                role: 'valve',
                deviceId: targets.valveDeviceId,
                imei: targets.valveImei,
                commandCode: 'OPEN_VALVE',
                delaySeconds: valveDelaySeconds
              },
              {
                role: 'pump',
                deviceId: targets.pumpDeviceId,
                imei: targets.pumpImei,
                commandCode: 'START_PUMP',
                delaySeconds: pumpDelaySeconds
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
            delay_seconds: step.delaySeconds
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
        stopToken: null,
        queued_commands: []
      };
    }

    const stopToken = `stop-${input.sessionId.slice(0, 8)}`;
    const steps = [
      {
        role: 'valve',
        deviceId: targets.valveDeviceId,
        imei: targets.valveImei,
        commandCode: 'CLOSE_VALVE',
        delaySeconds: 0
      },
      {
        role: 'pump',
        deviceId: targets.pumpDeviceId,
        imei: targets.pumpImei,
        commandCode: 'STOP_PUMP',
        delaySeconds: 3
      },
      {
        role: 'well',
        deviceId: targets.wellDeviceId,
        imei: targets.wellImei,
        commandCode: 'STOP_SESSION',
        delaySeconds: 6
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
          start_token: stopToken,
          create_dispatch: true,
          request_payload: {
            requested_from: 'runtime_engine',
            command_plan: 'session_stop',
            relation_id: input.relation.relationId,
            step_no: index + 1,
            role: step.role,
            delay_seconds: step.delaySeconds
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

  async createSession(decisionId: string, cardToken?: string | null) {
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
          sceneCode: decision.sceneCode
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
      const orderChannel = cardToken?.trim() ? 'CARD' : 'QR';
      const fundingMode = cardToken?.trim() ? 'card_wallet' : 'qr_postpaid';

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
          toStatus: 'running',
          actionCode: 'create_session',
          reasonCode: 'DECISION_ALLOW',
          reasonText: 'runtime decision passed and session entered running state',
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

    const durationSeconds =
      session.chargeDurationSec ??
      (session.startedAt
        ? Math.max(
            1,
            Math.ceil((Date.now() - new Date(session.startedAt).getTime()) / 1000)
          )
        : 0);

    const pricingDetail = (session.pricingDetail ?? {}) as Record<string, any>;
    const unit = String(pricingDetail.unit ?? session.unitType ?? 'minute');
    const usage =
      session.chargeVolume ??
      Number(pricingDetail.usage?.volume ?? pricingDetail.usage?.duration_seconds ?? 0);

    return {
      id: session.id,
      well_name: session.wellDisplayName ?? session.wellCode ?? session.wellId,
      status: session.status === 'ended' ? 'ended' : 'running',
      usage: Number(usage ?? 0),
      unit,
      duration_minutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      cost: Number(session.amount ?? 0),
      billing_package: session.billingPackageName ?? '--',
      unit_price: Number(pricingDetail.unit_price ?? 0),
      awaiting_device_ack: session.status === 'stopping'
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

      if (session.status === 'ended' || session.endedAt) {
        throw new AppException(ErrorCodes.SESSION_ALREADY_ENDED, 'Runtime session has already ended', 200, {
          sessionId,
          status: 'ended',
          idempotent: true,
          order
        });
      }

      if (session.status === 'stopping') {
        return {
          sessionId: session.id,
          status: session.status,
          order,
          sessionRef: session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`,
          queuedCommands: [],
          awaitingDeviceAck: true,
          idempotent: true
        };
      }

      if (!['pending_start', 'running', 'billing', 'stopping'].includes(session.status)) {
        throw new AppException(ErrorCodes.SESSION_NOT_STOPPABLE, 'Runtime session is not in a stoppable state', 400, {
          sessionId,
          status: session.status
        });
      }

      const sessionRef = session.sessionRef ?? `SIM-${session.id.slice(0, 8)}`;
      const queuedStopCommands = await this.queueSessionStopCommands({
        sessionId,
        sessionRef,
        orderId: order.id,
        relation: {
          relationId: null,
          wellId: session.wellId,
          pumpId: session.pumpId,
          valveId: session.valveId
        },
        client
      });

      await this.sessionStatusLogRepository.create(
        {
          tenantId: session.tenantId,
          sessionId,
          fromStatus: session.status,
          toStatus: 'stopping',
          actionCode: 'stop_session_requested',
          reasonCode: 'MANUAL_STOP',
          reasonText: 'stop request accepted and waiting for device acknowledgement',
          source: 'manual',
          actorId: runtimeUser.id,
          snapshot: {
            currentOrderStatus: order.status,
            sessionRef,
            queuedStopCommands
          }
        },
        client
      );

      const stopped = await this.runtimeRepository.stopSession(sessionId, client);
      if (!stopped) {
        throw new AppException(ErrorCodes.SESSION_NOT_STOPPABLE, 'Runtime session could not be stopped', 400, {
          sessionId
        });
      }

      return {
        sessionId: stopped.id,
        status: stopped.status,
        order,
        sessionRef,
        queuedCommands: queuedStopCommands.queued_commands,
        awaitingDeviceAck: true
      };
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
