import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/db/database.service';
import { OrderSettlementService } from '../src/modules/order/order-settlement.service';
import { SessionStatusLogRepository } from '../src/modules/runtime/session-status-log.repository';

type CandidateRow = {
  orderId: string;
  orderNo: string;
  sessionId: string;
  tenantId: string;
  sessionRef: string | null;
  sessionStatus: string;
  lockedAmount: number;
  refundedAmount: number;
  paymentStatus: string | null;
  pricingSnapshot: Record<string, unknown> | null;
  pricingDetail: Record<string, unknown> | null;
  walletBalance: number | null;
  walletLockedBalance: number | null;
  ageSec: number;
};

function readArg(name: string) {
  const prefix = `--${name}=`;
  const item = process.argv.find((entry) => entry.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function getTimeoutSec() {
  const fromArg = Number(readArg('min-age-sec'));
  if (Number.isFinite(fromArg) && fromArg > 0) return Math.trunc(fromArg);

  const fromEnv = Number(process.env.RUNTIME_SYNC_START_TIMEOUT_MS ?? '');
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.max(3, Math.trunc(fromEnv / 1000));

  return 15;
}

async function closeCandidate(
  db: DatabaseService,
  orderSettlementService: OrderSettlementService,
  sessionStatusLogRepository: SessionStatusLogRepository,
  row: CandidateRow,
) {
  const reasonCode = 'sync_start_timeout';
  const reasonText = 'manual batch cleanup of stale pending_start order after synchronous start timeout';
  const failureSource = 'manual_batch_cleanup';
  const failureMessage = 'manual batch cleanup of stale pending_start order';

  return db.withTransaction(async (client) => {
    const endedAt = new Date().toISOString();
    let sessionWasEndedHere = false;

    if (row.sessionStatus === 'pending_start') {
      await db.query(
        `
        update runtime_session
        set status = 'ended',
            ended_at = coalesce(ended_at, $2::timestamptz),
            end_reason_code = $3,
            updated_at = now()
        where id = $1::uuid
          and status = 'pending_start'
        `,
        [row.sessionId, endedAt, reasonCode],
        client,
      );

      await sessionStatusLogRepository.create(
        {
          tenantId: row.tenantId,
          sessionId: row.sessionId,
          fromStatus: 'pending_start',
          toStatus: 'ended',
          actionCode: 'start_session_failed',
          reasonCode,
          reasonText,
          source: 'system',
          snapshot: {
            ended_at: endedAt,
            session_ref: row.sessionRef ?? null,
            failure_source: failureSource,
            failure_message: failureMessage,
            gateway_event_type: null,
            gateway_event_code: reasonCode,
          },
        },
        client,
      );
      sessionWasEndedHere = true;
    }

    let settled;
    try {
      settled = await orderSettlementService.cancelOrderBeforeStart(row.sessionId, client, {
        settledAt: endedAt,
        gatewayEventType: null,
        gatewayEventCode: reasonCode,
        failureSource,
        failureMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (message !== 'WALLET_INSUFFICIENT_BALANCE') {
        throw error;
      }

      const refundedAmount = Number(row.lockedAmount ?? 0);
      const finalizedPricingDetail = {
        ...(row.pricingDetail ?? {}),
        settled_at: endedAt,
        refunded_amount: refundedAmount,
        underpaid_amount: 0,
        lifecycle_stage: 'settled',
        start_failure: true,
        start_failure_reason_code: reasonCode,
        start_failure_source: failureSource,
        start_failure_message: failureMessage,
        stop_reason_code: reasonCode,
        abnormal_stop: false,
        usage: {
          duration_seconds: 0,
          water_volume_m3: 0,
          energy_kwh: 0,
        },
        manual_cleanup_wallet_unlock_skipped: true,
        manual_cleanup_wallet_snapshot: {
          balance: row.walletBalance ?? 0,
          locked_balance: row.walletLockedBalance ?? 0,
          expected_locked_amount: refundedAmount,
          reason: 'wallet lock ledger missing, order cancelled without wallet mutation',
        },
      };
      const finalizedPricingSnapshot = {
        ...(row.pricingSnapshot ?? {}),
        breakdown: [
          { item: 'duration_seconds', value: 0 },
          { item: 'water_volume_m3', value: 0 },
          { item: 'energy_kwh', value: 0 },
          { item: 'amount', value: 0 },
          { item: 'refunded_amount', value: refundedAmount },
          { item: 'gateway_event_type', value: null },
          { item: 'gateway_event_code', value: reasonCode },
          { item: 'failure_source', value: failureSource },
          { item: 'failure_message', value: failureMessage },
          { item: 'manual_cleanup_wallet_unlock_skipped', value: true },
        ],
      };

      await db.query(
        `
        update irrigation_order
        set status = 'settled',
            settlement_status = 'cancelled',
            payment_status = 'refunded',
            refunded_amount = $2,
            charge_duration_sec = 0,
            charge_volume = 0,
            amount = 0,
            pricing_snapshot_json = $3::jsonb,
            pricing_detail_json = $4::jsonb,
            updated_at = now()
        where id = $1::uuid
        `,
        [
          row.orderId,
          refundedAmount,
          JSON.stringify(finalizedPricingSnapshot),
          JSON.stringify(finalizedPricingDetail),
        ],
        client,
      );

      settled = {
        orderId: row.orderId,
        sessionId: row.sessionId,
        amount: 0,
        refundedAmount,
        settlementStatus: 'cancelled',
        paymentStatus: 'refunded',
        underpaidAmount: 0,
      };
    }

    if (settled && sessionWasEndedHere) {
      await sessionStatusLogRepository.create(
        {
          tenantId: row.tenantId,
          sessionId: row.sessionId,
          fromStatus: 'ended',
          toStatus: 'settled',
          actionCode: 'start_failure_refunded',
          reasonCode,
          reasonText: 'irrigation order closed with full refund or unlock after start failure',
          source: 'system',
          snapshot: {
            session_ref: row.sessionRef ?? null,
            order_id: settled.orderId,
            amount: settled.amount,
            refunded_amount: settled.refundedAmount,
            settlement_status: settled.settlementStatus,
            payment_status: settled.paymentStatus,
          },
        },
        client,
      );
    }

    return {
      orderId: row.orderId,
      orderNo: row.orderNo,
      sessionId: row.sessionId,
      ageSec: row.ageSec,
      settled,
    };
  });
}

async function main() {
  const minAgeSec = getTimeoutSec();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const db = app.get(DatabaseService);
    const orderSettlementService = app.get(OrderSettlementService);
    const sessionStatusLogRepository = app.get(SessionStatusLogRepository);

    const candidates = await db.query<CandidateRow>(
      `
      select
        io.id as "orderId",
        io.order_no as "orderNo",
        rs.id as "sessionId",
        rs.tenant_id as "tenantId",
        rs.session_ref as "sessionRef",
        rs.status as "sessionStatus",
        coalesce(io.locked_amount, 0)::float8 as "lockedAmount",
        coalesce(io.refunded_amount, 0)::float8 as "refundedAmount",
        io.payment_status as "paymentStatus",
        io.pricing_snapshot_json as "pricingSnapshot",
        io.pricing_detail_json as "pricingDetail",
        coalesce(fw.balance, 0)::float8 as "walletBalance",
        coalesce(fw.locked_balance, 0)::float8 as "walletLockedBalance",
        extract(epoch from (now() - greatest(rs.updated_at, rs.created_at)))::int as "ageSec"
      from irrigation_order io
      join runtime_session rs on rs.id = io.session_id
      left join farmer_wallet fw on fw.tenant_id = io.tenant_id and fw.user_id = io.user_id
      where rs.status = 'pending_start'
        and extract(epoch from (now() - greatest(rs.updated_at, rs.created_at)))::int >= $1
      order by rs.created_at asc
      `,
      [minAgeSec],
    );

    const repaired = [];
    for (const row of candidates.rows) {
      repaired.push(await closeCandidate(db, orderSettlementService, sessionStatusLogRepository, row));
    }

    console.log(
      JSON.stringify(
        {
          minAgeSec,
          scanned: candidates.rows.length,
          repaired: repaired.length,
          candidates: repaired,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
