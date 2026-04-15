import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import type { PoolClient } from 'pg';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/db/database.service';
import { FarmerFundService } from '../src/modules/farmer-fund/farmer-fund.service';
import { SessionStatusLogRepository } from '../src/modules/runtime/session-status-log.repository';

type RepairContext = {
  orderId: string;
  orderNo: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  sessionRef: string | null;
  orderStatus: string;
  settlementStatus: string | null;
  paymentStatus: string | null;
  fundingMode: string | null;
  paymentMode: string | null;
  lockedAmount: number;
  prepaidAmount: number;
  refundedAmount: number;
  sourcePaymentIntentId: string | null;
  orderAmount: number;
  sessionStatus: string;
  startedAt: string | null;
  endedAt: string | null;
  endReasonCode: string | null;
  pricingSnapshot: Record<string, unknown>;
  pricingDetail: Record<string, unknown>;
};

function readArg(name: string) {
  const prefix = `--${name}=`;
  const item = process.argv.find((entry) => entry.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInteger(value: unknown) {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundMetric(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeBillingMode(value: unknown) {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'time' || normalized === 'duration') return 'time';
  if (normalized === 'flat') return 'flat';
  if (normalized === 'free') return 'free';
  return 'time';
}

function calculateTimeUnits(durationSec: number, unitType: unknown) {
  const normalized = asString(unitType).toLowerCase();
  if (normalized === 'hour' || normalized === 'hours' || normalized === '小时') {
    return durationSec / 3600;
  }
  if (normalized === 'second' || normalized === 'seconds' || normalized === 'sec' || normalized === '秒') {
    return durationSec;
  }
  return durationSec / 60;
}

function computeClockDurationSeconds(context: RepairContext, effectiveAt: string) {
  if (!context.startedAt) {
    return 0;
  }

  const startedAt = new Date(context.startedAt);
  const endAt = new Date(effectiveAt);
  const rawDurationSec = Math.max(0, Math.floor((endAt.getTime() - startedAt.getTime()) / 1000));
  const pauseSummary = asObject(context.pricingDetail.pause_summary);
  const currentSegment = asObject(pauseSummary.current_segment);
  const totalPausedSec = Math.max(0, asInteger(pauseSummary.total_paused_duration_sec) ?? 0);
  const openPauseAt =
    asString(currentSegment.pause_confirmed_at) ||
    asString(currentSegment.pause_requested_at) ||
    null;
  const resumeConfirmedAt = asString(currentSegment.resume_confirmed_at) || null;
  const openPauseSec =
    openPauseAt && !resumeConfirmedAt
      ? Math.max(0, Math.floor((endAt.getTime() - new Date(openPauseAt).getTime()) / 1000))
      : 0;

  return Math.max(0, rawDurationSec - totalPausedSec - openPauseSec);
}

function calculateAmount(context: RepairContext, durationSec: number) {
  const pricingRules = asObject(context.pricingSnapshot.pricingRules);
  const detailPreview = asObject(context.pricingDetail.price_preview);
  const mode = normalizeBillingMode(
    context.pricingSnapshot.mode ??
      context.pricingDetail.billing_mode ??
      detailPreview.billingMode
  );
  const unitPrice = Number(
    asNumber(context.pricingSnapshot.unitPrice) ??
      asNumber(context.pricingDetail.unit_price) ??
      asNumber(detailPreview.unitPrice) ??
      0
  );
  const minCharge = Number(
    asNumber(context.pricingSnapshot.minChargeAmount) ??
      asNumber(context.pricingDetail.min_charge) ??
      asNumber(detailPreview.minChargeAmount) ??
      0
  );

  if (mode === 'free') {
    return { amount: 0, rawAmount: 0 };
  }

  if (mode === 'flat') {
    const flatAmount = roundMoney(Math.max(minCharge, unitPrice));
    return { amount: flatAmount, rawAmount: flatAmount };
  }

  const timeUnits = calculateTimeUnits(
    durationSec,
    pricingRules.time_unit ?? pricingRules.timeUnit ?? context.pricingSnapshot.unitType ?? detailPreview.unitType
  );
  const rawAmount = roundMoney(timeUnits * unitPrice);
  if (rawAmount <= 0) {
    return { amount: 0, rawAmount };
  }

  return {
    amount: roundMoney(Math.max(minCharge, rawAmount)),
    rawAmount,
  };
}

async function loadContext(client: PoolClient, db: DatabaseService, orderId: string) {
  const result = await db.query<RepairContext>(
    `
    select
      io.id as "orderId",
      io.order_no as "orderNo",
      io.tenant_id as "tenantId",
      io.user_id as "userId",
      io.session_id as "sessionId",
      rs.session_ref as "sessionRef",
      io.status as "orderStatus",
      io.settlement_status as "settlementStatus",
      io.payment_status as "paymentStatus",
      io.funding_mode as "fundingMode",
      io.payment_mode as "paymentMode",
      coalesce(io.locked_amount, 0)::float8 as "lockedAmount",
      coalesce(io.prepaid_amount, 0)::float8 as "prepaidAmount",
      coalesce(io.refunded_amount, 0)::float8 as "refundedAmount",
      io.source_payment_intent_id as "sourcePaymentIntentId",
      coalesce(io.amount, 0)::float8 as "orderAmount",
      rs.status as "sessionStatus",
      rs.started_at::text as "startedAt",
      rs.ended_at::text as "endedAt",
      rs.end_reason_code as "endReasonCode",
      io.pricing_snapshot_json as "pricingSnapshot",
      io.pricing_detail_json as "pricingDetail"
    from irrigation_order io
    join runtime_session rs on rs.id = io.session_id
    where io.id = $1::uuid
    for update of io, rs
    `,
    [orderId],
    client
  );
  return result.rows[0] ?? null;
}

async function main() {
  const orderId = readArg('order-id');
  if (!orderId) {
    throw new Error('missing --order-id');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const db = app.get(DatabaseService);
    const farmerFundService = app.get(FarmerFundService);
    const sessionStatusLogRepository = app.get(SessionStatusLogRepository);

    const result = await db.withTransaction(async (client) => {
      const context = await loadContext(client, db, orderId);
      if (!context) {
        throw new Error(`order not found: ${orderId}`);
      }

      if (context.orderStatus === 'settled') {
        return {
          orderId: context.orderId,
          orderNo: context.orderNo,
          alreadySettled: true,
          amount: context.orderAmount,
        };
      }

      const stopRequestedAt =
        asString(context.pricingDetail.stop_requested_at) ||
        asString(asObject(context.pricingDetail.stop_request_snapshot).requested_at) ||
        asString(context.pricingDetail.stop_pending_review_at) ||
        context.endedAt ||
        new Date().toISOString();
      const settledAt = new Date().toISOString();
      const durationSec = computeClockDurationSeconds(context, stopRequestedAt);
      const amountResult = calculateAmount(context, durationSec);
      const usageWater = roundMetric(
        Number(
          asNumber(asObject(context.pricingDetail.usage).water_volume_m3) ??
            asNumber(asObject(asObject(context.pricingDetail.stop_request_snapshot).usage).water_volume_m3) ??
            asNumber(context.pricingDetail.usage_water_volume_m3) ??
            0
        )
      );
      const usageEnergy = roundMetric(
        Number(
          asNumber(asObject(context.pricingDetail.usage).energy_kwh) ??
            asNumber(asObject(asObject(context.pricingDetail.stop_request_snapshot).usage).energy_kwh) ??
            asNumber(context.pricingDetail.usage_energy_kwh) ??
            0
        )
      );
      const creditLimitAmount = roundMoney(Math.max(context.prepaidAmount, context.lockedAmount));
      const creditLimitReached = creditLimitAmount > 0 && amountResult.amount >= creditLimitAmount;

      let refundedAmount = 0;
      let underpaidAmount = 0;
      let paymentStatus = context.paymentStatus ?? 'unpaid';
      let settlementStatus = context.settlementStatus ?? 'unpaid';

      if (context.fundingMode === 'card_wallet_locked' || (context.paymentMode === 'card' && context.lockedAmount > 0)) {
        const settled = await farmerFundService.settleLockedOrder(client, {
          tenantId: context.tenantId,
          userId: context.userId,
          orderId: context.orderId,
          chargeAmount: amountResult.amount,
          lockedAmount: context.lockedAmount,
        });
        refundedAmount = roundMoney(settled.unlockedAmount);
        underpaidAmount = roundMoney(settled.underpaidAmount);
        paymentStatus = underpaidAmount > 0 ? 'underpaid' : 'paid';
        settlementStatus = underpaidAmount > 0 ? 'partial_paid' : 'paid';
      } else {
        throw new Error(`unsupported repair funding mode: ${context.fundingMode ?? context.paymentMode ?? 'unknown'}`);
      }

      const previousSessionStatus = context.sessionStatus;
      if (previousSessionStatus !== 'ended') {
        await db.query(
          `
          update runtime_session
          set status = 'ended',
              ended_at = coalesce(ended_at, $2::timestamptz),
              end_reason_code = 'manual_stop_review_closed',
              updated_at = now()
          where id = $1::uuid
          `,
          [context.sessionId, stopRequestedAt],
          client
        );

        await sessionStatusLogRepository.create(
          {
            tenantId: context.tenantId,
            sessionId: context.sessionId,
            fromStatus: previousSessionStatus,
            toStatus: 'ended',
            actionCode: 'manual_stop_review_closed',
            reasonCode: 'MANUAL_REPAIR',
            reasonText: 'closed stop_pending_review session with frozen stop-request amount',
            source: 'manual',
            snapshot: {
              session_ref: context.sessionRef ?? null,
              order_id: context.orderId,
              ended_at: stopRequestedAt,
              charge_duration_sec: durationSec,
              charge_amount: amountResult.amount,
            },
          },
          client
        );
      }

      const previousMetricSnapshot = asObject(context.pricingDetail.metric_snapshot);
      const previousBaseline = asObject(previousMetricSnapshot.baseline);
      const correctedMetricSnapshot = {
        baseline: {
          runtimeSec: Math.max(0, asInteger(previousBaseline.runtimeSec) ?? 0),
          waterTotalM3: asNumber(previousBaseline.waterTotalM3) ?? usageWater,
          energyKwh: asNumber(previousBaseline.energyKwh) ?? usageEnergy,
        },
        current: {
          runtimeSec: Math.max(0, (asInteger(previousBaseline.runtimeSec) ?? 0) + durationSec),
          waterTotalM3: roundMetric((asNumber(previousBaseline.waterTotalM3) ?? 0) + usageWater),
          energyKwh: roundMetric((asNumber(previousBaseline.energyKwh) ?? 0) + usageEnergy),
        },
      };

      const correctedStopRequestSnapshot = {
        ...asObject(context.pricingDetail.stop_request_snapshot),
        requested_at: stopRequestedAt,
        amount: amountResult.amount,
        raw_amount: amountResult.rawAmount,
        credit_limit_amount: creditLimitAmount,
        credit_limit_reached: creditLimitReached,
        usage_duration_sec: durationSec,
        usage_water_volume_m3: usageWater,
        usage_energy_kwh: usageEnergy,
        usage: {
          duration_seconds: durationSec,
          water_volume_m3: usageWater,
          energy_kwh: usageEnergy,
        },
        metric_snapshot: correctedMetricSnapshot,
      };

      const correctedStopPendingReviewSnapshot = {
        ...asObject(context.pricingDetail.stop_pending_review_snapshot),
        amount: amountResult.amount,
        usage: {
          duration_seconds: durationSec,
          water_volume_m3: usageWater,
          energy_kwh: usageEnergy,
        },
        stop_request_snapshot: correctedStopRequestSnapshot,
      };

      const correctedPricingDetail = {
        ...context.pricingDetail,
        lifecycle_stage: 'settled',
        settled_at: settledAt,
        stop_requested_at: stopRequestedAt,
        stop_amount_frozen: true,
        stop_amount_frozen_reason: 'manual_stop_review_closed',
        stop_pending_review: false,
        stop_pending_review_resolved_at: settledAt,
        stop_pending_review_resolution: 'manual_stop_review_closed',
        stop_reason_code: 'manual_stop_review_closed',
        abnormal_stop: false,
        billing_mode: normalizeBillingMode(
          context.pricingSnapshot.mode ?? context.pricingDetail.billing_mode ?? asObject(context.pricingDetail.price_preview).billingMode
        ),
        unit_price: Number(
          asNumber(context.pricingSnapshot.unitPrice) ??
            asNumber(context.pricingDetail.unit_price) ??
            asNumber(asObject(context.pricingDetail.price_preview).unitPrice) ??
            0
        ),
        min_charge: Number(
          asNumber(context.pricingSnapshot.minChargeAmount) ??
            asNumber(context.pricingDetail.min_charge) ??
            asNumber(asObject(context.pricingDetail.price_preview).minChargeAmount) ??
            0
        ),
        usage: {
          duration_seconds: durationSec,
          water_volume_m3: usageWater,
          energy_kwh: usageEnergy,
        },
        duration_seconds: durationSec,
        subtotal: amountResult.rawAmount,
        final_amount: amountResult.amount,
        current_amount: amountResult.amount,
        credit_limit_amount: creditLimitAmount,
        credit_limit_reached: creditLimitReached,
        refunded_amount: refundedAmount,
        underpaid_amount: underpaidAmount,
        metric_snapshot: correctedMetricSnapshot,
        stop_request_snapshot: correctedStopRequestSnapshot,
        stop_pending_review_snapshot: correctedStopPendingReviewSnapshot,
        last_progress_at: settledAt,
        manual_repair_snapshot: {
          repaired_at: settledAt,
          previous_amount: context.orderAmount,
          previous_payment_status: context.paymentStatus ?? null,
          previous_settlement_status: context.settlementStatus ?? null,
          settled_from_session_status: previousSessionStatus,
          settled_from_order_status: context.orderStatus,
        },
      };

      const correctedPricingSnapshot = {
        ...context.pricingSnapshot,
        breakdown: [
          { item: 'duration_seconds', value: durationSec },
          { item: 'water_volume_m3', value: usageWater },
          { item: 'energy_kwh', value: usageEnergy },
          { item: 'amount', value: amountResult.amount },
          { item: 'refunded_amount', value: refundedAmount },
          { item: 'underpaid_amount', value: underpaidAmount },
          { item: 'stop_reason_code', value: 'manual_stop_review_closed' },
          { item: 'settled_via', value: 'manual_repair' },
        ],
      };

      await db.query(
        `
        update irrigation_order
        set status = 'settled',
            settlement_status = $2,
            payment_status = $3,
            refunded_amount = $4,
            charge_duration_sec = $5,
            charge_volume = $6,
            amount = $7,
            pricing_snapshot_json = $8::jsonb,
            pricing_detail_json = $9::jsonb,
            pricing_progress_at = now(),
            updated_at = now()
        where id = $1::uuid
        `,
        [
          context.orderId,
          settlementStatus,
          paymentStatus,
          refundedAmount,
          durationSec,
          usageWater,
          amountResult.amount,
          JSON.stringify(correctedPricingSnapshot),
          JSON.stringify(correctedPricingDetail),
        ],
        client
      );

      await sessionStatusLogRepository.create(
        {
          tenantId: context.tenantId,
          sessionId: context.sessionId,
          fromStatus: 'ended',
          toStatus: 'settled',
          actionCode: 'manual_order_settled',
          reasonCode: 'MANUAL_REPAIR',
          reasonText: 'settled order after correcting a stale stop_pending_review amount',
          source: 'manual',
          snapshot: {
            session_ref: context.sessionRef ?? null,
            order_id: context.orderId,
            amount: amountResult.amount,
            refunded_amount: refundedAmount,
            underpaid_amount: underpaidAmount,
            settlement_status: settlementStatus,
            payment_status: paymentStatus,
          },
        },
        client
      );

      return {
        orderId: context.orderId,
        orderNo: context.orderNo,
        sessionId: context.sessionId,
        previousAmount: context.orderAmount,
        correctedAmount: amountResult.amount,
        durationSec,
        refundedAmount,
        underpaidAmount,
        settlementStatus,
        paymentStatus,
        endedAt: stopRequestedAt,
        settledAt,
      };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
