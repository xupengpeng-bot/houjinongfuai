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
import { OrderRepository } from '../order/order.repository';
import { EffectivePolicyResolver, FIXED_PRIORITY_CHAIN } from '../policy/effective-policy.resolver';
import { TopologyService } from '../topology/topology.service';
import { RuntimeRepository } from './runtime.repository';
import { SessionStatusLogRepository } from './session-status-log.repository';

@Injectable()
export class RuntimeDecisionService {
  constructor(
    private readonly topologyService: TopologyService,
    private readonly effectivePolicyResolver: EffectivePolicyResolver,
    private readonly runtimeRepository: RuntimeRepository
  ) {}

  async createStartDecision(input: { targetType: 'valve' | 'well' | 'session'; targetId: string; sceneCode?: string }): Promise<RuntimeDecisionContract> {
    const runtimeUser = await this.getRuntimeUser();
    const evaluated = await this.evaluateStartEligibility(
      {
        targetType: input.targetType,
        targetId: input.targetId,
        sceneCode: input.sceneCode ?? 'farmer_scan_start'
      },
      runtimeUser.id
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

  async evaluateStartEligibility(
    input: { targetType: 'valve' | 'well' | 'session'; targetId: string; sceneCode: string },
    runtimeUserId: string,
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

  async getRuntimeUser() {
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
    private readonly sessionStatusLogRepository: SessionStatusLogRepository
  ) {}

  async createSession(decisionId: string) {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser();

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

      const session = await this.runtimeRepository.createRuntimeSession(
        {
          tenantId: decision.tenantId,
          userId: decision.userId,
          wellId: relation.wellId,
          pumpId: relation.pumpId,
          valveId: relation.valveId,
          sourceDecisionId: decision.id,
          telemetrySnapshot: {
            startedBy: 'phase-1-runtime',
            traceId: randomUUID(),
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
          pricingDetail: this.buildDraftPricingDetail(pricingSnapshot, guard.effectiveRuleSnapshot, guard.pricePreview)
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
            effectiveRuleSource: snapshot.resolved_from ?? {}
          }
        },
        client
      );

      return {
        sessionId: session.id,
        status: session.status,
        sessionNo: session.sessionNo
      };
    });
  }

  async createSessionFromWellIdentifier(wellIdentifier: string) {
    const decision = await this.createStartDecisionForWellIdentifier(wellIdentifier);

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

    return this.createSession(decision.decisionId);
  }

  async createStartDecisionForWellIdentifier(wellIdentifier: string) {
    const resolvedWellId = await this.runtimeRepository.findWellIdByIdentifier(wellIdentifier);
    if (!resolvedWellId) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Target well was not found', 404, {
        targetId: wellIdentifier
      });
    }

    return this.runtimeDecisionService.createStartDecision({
      targetType: 'well',
      targetId: resolvedWellId,
      sceneCode: 'farmer_scan_start'
    });
  }

  async getCurrentSession() {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser();
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
      status: session.status === 'running' ? 'running' : 'ended',
      usage: Number(usage ?? 0),
      unit,
      duration_minutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      cost: Number(session.amount ?? 0),
      billing_package: session.billingPackageName ?? '--',
      unit_price: Number(pricingDetail.unit_price ?? 0)
    };
  }

  async listSessions() {
    return this.runtimeRepository.findAllSessions();
  }

  async listCommands() {
    return this.runtimeRepository.findAllCommands();
  }

  async listRuntimeContainers() {
    return [
      {
        id: 'runtime-api',
        name: 'Runtime API',
        status: 'running',
        cpu: '0.2 vCPU',
        mem: '128 MB',
        uptime: 'local-dev'
      },
      {
        id: 'postgres',
        name: 'PostgreSQL',
        status: 'running',
        cpu: '0.3 vCPU',
        mem: '256 MB',
        uptime: 'docker'
      }
    ];
  }

  async stopSession(sessionId: string) {
    const runtimeUser = await this.runtimeDecisionService.getRuntimeUser();

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

      if (!['pending_start', 'running', 'billing', 'stopping'].includes(session.status)) {
        throw new AppException(ErrorCodes.SESSION_NOT_STOPPABLE, 'Runtime session is not in a stoppable state', 400, {
          sessionId,
          status: session.status
        });
      }

      await this.sessionStatusLogRepository.create(
        {
          tenantId: session.tenantId,
          sessionId,
          fromStatus: session.status,
          toStatus: 'ending',
          actionCode: 'stop_session_accepted',
          reasonCode: 'MANUAL_STOP',
          reasonText: 'stop request accepted',
          source: 'manual',
          actorId: runtimeUser.id,
          snapshot: {
            currentOrderStatus: order.status
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

      await this.sessionStatusLogRepository.create(
        {
          tenantId: stopped.tenantId,
          sessionId,
          fromStatus: 'ending',
          toStatus: 'ended',
          actionCode: 'stop_session_completed',
          reasonCode: 'MANUAL_STOP',
          reasonText: 'session stop completed',
          source: 'runtime_engine',
          actorId: runtimeUser.id,
          snapshot: {}
        },
        client
      );

      const startedAt = new Date(stopped.startedAt);
      const endedAt = new Date(stopped.endedAt);
      const durationSec = Math.max(1, Math.ceil((endedAt.getTime() - startedAt.getTime()) / 1000));
      const pricingSnapshot = (order.pricingSnapshot ?? {}) as Record<string, any>;
      const unitPrice = Number(pricingSnapshot.unitPrice ?? 0);
      const minChargeAmount = Number(pricingSnapshot.minChargeAmount ?? 0);
      const mode = String(pricingSnapshot.mode ?? 'duration');

      let amount = 0;
      if (mode === 'duration') {
        amount = Math.max(minChargeAmount, Math.ceil(durationSec / 60) * unitPrice);
      } else if (mode === 'flat') {
        amount = Math.max(minChargeAmount, unitPrice);
      } else if (mode === 'free') {
        amount = 0;
      } else {
        amount = Math.max(minChargeAmount, unitPrice);
      }

      const finalized = await this.orderRepository.finalize(
        {
          orderId: order.id,
          chargeDurationSec: durationSec,
          amount,
          pricingSnapshot: {
            ...pricingSnapshot,
            breakdown: [
              { item: 'runtime_duration_seconds', value: durationSec },
              { item: 'amount', value: amount }
            ]
          },
          pricingDetail: this.buildSettledPricingDetail(order.pricingDetail ?? {}, pricingSnapshot, durationSec, amount)
        },
        client
      );

      await this.sessionStatusLogRepository.create(
        {
          tenantId: stopped.tenantId,
          sessionId,
          fromStatus: 'ended',
          toStatus: 'settled',
          actionCode: 'settle_success',
          reasonCode: 'ORDER_SETTLED',
          reasonText: 'irrigation order settled successfully',
          source: 'runtime_engine',
          actorId: runtimeUser.id,
          snapshot: {
            orderId: order.id,
            finalAmount: finalized.amount
          }
        },
        client
      );

      return {
        sessionId: stopped.id,
        status: stopped.status,
        order: finalized
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
