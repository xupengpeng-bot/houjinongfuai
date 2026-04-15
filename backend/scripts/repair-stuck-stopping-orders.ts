import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/db/database.service';
import { OrderSettlementService } from '../src/modules/order/order-settlement.service';

type CandidateRow = {
  orderId: string;
  orderNo: string;
  sessionId: string;
  sessionRef: string | null;
  lifecycleStage: string | null;
  sessionStatus: string;
  amount: string;
  stopRequestedAt: string | null;
  failedAt: string | null;
  timeoutAt: string | null;
  commandId: string | null;
  commandToken: string | null;
  commandCode: string | null;
  commandStatus: string | null;
};

function readArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

async function main() {
  const onlyOrderId = readArg('order-id');
  const onlySessionId = readArg('session-id');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const db = app.get(DatabaseService);
    const orderSettlementService = app.get(OrderSettlementService);

    const candidates = await db.query<CandidateRow>(
      `
      with latest_stop_command as (
        select distinct on (dc.session_id)
          dc.session_id,
          dc.command_id,
          dc.command_code,
          dc.command_status,
          dc.failed_at,
          dc.timeout_at,
          dc.request_payload_json->>'device_command_token' as command_token
        from device_command dc
        where dc.command_code = 'STOP_SESSION'
        order by dc.session_id, dc.created_at desc
      ),
      stop_request_log as (
        select distinct on (ssl.session_id)
          ssl.session_id,
          ssl.created_at as stop_requested_at
        from session_status_log ssl
        where ssl.action_code = 'stop_session_requested'
        order by ssl.session_id, ssl.created_at desc
      )
      select
        io.id as "orderId",
        io.order_no as "orderNo",
        rs.id as "sessionId",
        rs.session_ref as "sessionRef",
        io.pricing_detail_json->>'lifecycle_stage' as "lifecycleStage",
        rs.status as "sessionStatus",
        io.amount::text as amount,
        srl.stop_requested_at::text as "stopRequestedAt",
        lsc.failed_at::text as "failedAt",
        lsc.timeout_at::text as "timeoutAt",
        lsc.command_id as "commandId",
        lsc.command_token as "commandToken",
        lsc.command_code as "commandCode",
        lsc.command_status as "commandStatus"
      from irrigation_order io
      join runtime_session rs on rs.id = io.session_id
      join latest_stop_command lsc on lsc.session_id = rs.id
      left join stop_request_log srl on srl.session_id = rs.id
      where rs.status = 'stopping'
        and coalesce(io.pricing_detail_json->>'lifecycle_stage', '') = 'stopping'
        and lsc.command_status in ('dead_letter', 'failed', 'nack')
        and ($1::uuid is null or io.id = $1::uuid)
        and ($2::uuid is null or rs.id = $2::uuid)
      order by io.updated_at desc
      `,
      [onlyOrderId, onlySessionId],
    );

    if (!candidates.rows.length) {
      console.log(JSON.stringify({ repaired: 0, candidates: [] }, null, 2));
      return;
    }

    const repaired: Array<Record<string, unknown>> = [];

    for (const candidate of candidates.rows) {
      const frozenAt = candidate.stopRequestedAt ?? candidate.failedAt ?? candidate.timeoutAt ?? new Date().toISOString();
      const reviewAt = candidate.failedAt ?? candidate.timeoutAt ?? new Date().toISOString();

      const result = await db.withTransaction(async (client) => {
        await orderSettlementService.freezeProgressAtStopRequest(candidate.sessionId, client, {
          frozenAt,
          reasonCode: 'ack_timeout_exceeded',
          reasonText: 'repair stale stopping order at stop requested time',
          source: 'repair_stuck_stopping_orders_script',
        });

        return orderSettlementService.markStopPendingReview(candidate.sessionId, client, {
          reviewAt,
          reasonCode: 'ack_timeout_exceeded',
          reasonText: 'repair stale stopping order after dead-letter timeout',
          source: 'repair_stuck_stopping_orders_script',
          commandId: candidate.commandId,
          commandToken: candidate.commandToken,
          commandCode: candidate.commandCode,
        });
      });

      const refreshed = await db.query<{
        lifecycleStage: string | null;
        amount: string;
        pricingDetail: Record<string, unknown>;
      }>(
        `
        select
          pricing_detail_json->>'lifecycle_stage' as "lifecycleStage",
          amount::text as amount,
          pricing_detail_json as "pricingDetail"
        from irrigation_order
        where id = $1::uuid
        `,
        [candidate.orderId],
      );

      repaired.push({
        orderId: candidate.orderId,
        orderNo: candidate.orderNo,
        sessionId: candidate.sessionId,
        previousLifecycle: candidate.lifecycleStage,
        previousAmount: candidate.amount,
        frozenAt,
        reviewAt,
        resultAmount: result?.amount ?? null,
        newLifecycle: refreshed.rows[0]?.lifecycleStage ?? null,
        newAmount: refreshed.rows[0]?.amount ?? null,
        stopRequestedAt: refreshed.rows[0]?.pricingDetail?.stop_requested_at ?? null,
        stopPendingReviewAt: refreshed.rows[0]?.pricingDetail?.stop_pending_review_at ?? null,
      });
    }

    console.log(
      JSON.stringify(
        {
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
