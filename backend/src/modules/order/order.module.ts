import { Controller, Get, Headers, Module, Param, Post, Query } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { FarmerFundModule } from '../farmer-fund/farmer-fund.module';
import { FarmerFundService } from '../farmer-fund/farmer-fund.service';
import { deriveFormalOrderLifecycleStage } from './order-lifecycle';
import { OrderRepository } from './order.repository';
import { OrderSettlementService } from './order-settlement.service';
import { OrderService } from './order.service';

@Controller()
class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly farmerFundService: FarmerFundService,
    private readonly orderSettlementService: OrderSettlementService
  ) {}

  private mapOrderForPage(order: {
    id: string;
    userDisplayName?: string | null;
    userMobile?: string | null;
    orderNo?: string | null;
    sessionId?: string | null;
    sessionRef?: string | null;
    wellCode?: string | null;
    wellDisplayName?: string | null;
    billingPackageName?: string | null;
    unitType?: string | null;
    orderChannel?: string | null;
    fundingMode?: string | null;
    sourcePaymentIntentId?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    sessionStatus?: string | null;
    chargeDurationSec?: number | null;
    chargeVolume?: number | null;
    amount: number;
    status: string;
    settlementStatus?: string | null;
    paymentMode?: string | null;
    paymentStatus?: string | null;
    prepaidAmount?: number | null;
    lockedAmount?: number | null;
    refundedAmount?: number | null;
    targetImei?: string | null;
    targetDeviceRole?: string | null;
    endReasonCode?: string | null;
    pricingDetail?: Record<string, unknown>;
    pricingSnapshot?: Record<string, unknown>;
    checkoutSnapshot?: Record<string, unknown>;
  }) {
    const pricingDetail = (order.pricingDetail ?? {}) as Record<string, any>;
    const usage =
      order.chargeVolume ??
      Number(
        pricingDetail.usage?.water_volume_m3 ??
          pricingDetail.usage?.volume ??
          pricingDetail.usage?.duration_seconds ??
          0
      );
    const unit = String(pricingDetail.unit ?? order.unitType ?? 'minute');
    const pumpHealth = (pricingDetail.pump_health?.summary ?? null) as Record<string, unknown> | null;
    const stopReasonCode =
      (pricingDetail.stop_reason_code as string | undefined | null) ??
      order.endReasonCode ??
      null;
    const lifecycleStage = deriveFormalOrderLifecycleStage({
      explicitLifecycle: pricingDetail.lifecycle_stage,
      orderStatus: order.status,
      sessionStatus: order.sessionStatus,
      pricingDetail
    });

    return {
      id: order.id,
      order_no: order.orderNo ?? order.id,
      user: order.userDisplayName ?? '--',
      phone: order.userMobile ?? '--',
      well: order.wellDisplayName ?? order.wellCode ?? '--',
      billing: order.billingPackageName ?? '--',
      start_time: order.startedAt,
      end_time: order.endedAt,
      session_ref: order.sessionRef ?? null,
      usage: Number(usage ?? 0),
      unit,
      amount: Number(order.amount ?? 0),
      status: order.settlementStatus === 'unpaid' || order.status === 'created' ? 'active' : 'completed',
      lifecycle_stage: lifecycleStage,
      payment_mode: order.paymentMode ?? '--',
      payment_status: order.paymentStatus ?? '--',
      prepaid_amount: Number(order.prepaidAmount ?? 0),
      locked_amount: Number(order.lockedAmount ?? 0),
      refunded_amount: Number(order.refundedAmount ?? 0),
      target_imei: order.targetImei ?? null,
      target_device_role: order.targetDeviceRole ?? null,
      stop_reason_code: stopReasonCode,
      abnormal_stop: Boolean(pricingDetail.abnormal_stop),
      usage_detail: pricingDetail.usage ?? {},
      pump_health: pumpHealth,
    };
  }

  private mapOrderForDetail(order: {
    id: string;
    userDisplayName?: string | null;
    userMobile?: string | null;
    orderNo?: string | null;
    sessionId?: string | null;
    sessionRef?: string | null;
    wellCode?: string | null;
    wellDisplayName?: string | null;
    billingPackageName?: string | null;
    unitType?: string | null;
    orderChannel?: string | null;
    fundingMode?: string | null;
    sourcePaymentIntentId?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    sessionStatus?: string | null;
    chargeDurationSec?: number | null;
    chargeVolume?: number | null;
    amount: number;
    status: string;
    settlementStatus?: string | null;
    paymentMode?: string | null;
    paymentStatus?: string | null;
    prepaidAmount?: number | null;
    lockedAmount?: number | null;
    refundedAmount?: number | null;
    targetImei?: string | null;
    targetDeviceRole?: string | null;
    endReasonCode?: string | null;
    pricingDetail?: Record<string, unknown>;
    pricingSnapshot?: Record<string, unknown>;
    checkoutSnapshot?: Record<string, unknown>;
  } | null, paymentIntent?: {
    id: string;
    status: string;
    outTradeNo: string;
    amount: number;
    refundedAmount: number;
    createdAt: string;
    paidAt: string | null;
    refundedAt: string | null;
    expiredAt: string | null;
    paymentAccountSnapshot?: Record<string, unknown>;
    checkoutSnapshot?: Record<string, unknown>;
    providerPayload?: Record<string, unknown>;
  } | null) {
    if (!order) return null;
    return {
      ...this.mapOrderForPage(order),
      order_no: order.orderNo ?? order.id,
      session_id: order.sessionId ?? null,
      session_ref: order.sessionRef ?? null,
      session_status: order.sessionStatus ?? null,
      settlement_status: order.settlementStatus ?? null,
      order_channel: order.orderChannel ?? null,
      funding_mode: order.fundingMode ?? null,
      source_payment_intent_id: order.sourcePaymentIntentId ?? null,
      charge_duration_sec: Number(order.chargeDurationSec ?? 0),
      charge_volume: Number(order.chargeVolume ?? 0),
      pricing_snapshot: order.pricingSnapshot ?? {},
      pricing_detail: order.pricingDetail ?? {},
      checkout_snapshot: order.checkoutSnapshot ?? {},
      payment_intent_summary: paymentIntent
        ? {
            id: paymentIntent.id,
            status: paymentIntent.status,
            out_trade_no: paymentIntent.outTradeNo,
            amount: Number(paymentIntent.amount ?? 0),
            refunded_amount: Number(paymentIntent.refundedAmount ?? 0),
            created_at: paymentIntent.createdAt,
            paid_at: paymentIntent.paidAt,
            refunded_at: paymentIntent.refundedAt,
            expired_at: paymentIntent.expiredAt,
            payment_account_snapshot: paymentIntent.paymentAccountSnapshot ?? {},
            checkout_snapshot: paymentIntent.checkoutSnapshot ?? {},
            provider_payload: paymentIntent.providerPayload ?? {},
          }
        : null,
    };
  }

  @Get('orders')
  async listOrders(
    @Query('page') pageRaw?: string,
    @Query('page_size') pageSizeRaw?: string,
    @Query('target_imei') targetImei?: string
  ) {
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(pageSizeRaw ?? '20', 10) || 20));
    const result = await this.orderService.listOrdersPage({
      page,
      pageSize,
      targetImei: targetImei?.trim() || null
    });

    return ok({
      items: result.rows.map((item) => this.mapOrderForPage(item)),
      total: result.total,
      page,
      page_size: pageSize
    });
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    const order = await this.orderService.getOrder(id);
    const paymentIntent =
      order?.sourcePaymentIntentId ? await this.orderSettlementService.getPaymentIntentById(order.sourcePaymentIntentId) : null;
    return ok(this.mapOrderForDetail(order, paymentIntent));
  }

  @Get('orders/:id/pricing')
  async pricing(@Param('id') id: string) {
    const order = await this.orderService.getOrder(id);
    return ok({
      id,
      lines: order?.pricingSnapshot?.breakdown ?? []
    });
  }

  @Post('orders/:id/review')
  review(@Param('id') id: string) {
    return ok({ id, reviewed: true });
  }

  @Get('u/orders')
  async userOrders(
    @Headers('x-farmer-card-token') card?: string,
    @Query('page') pageRaw?: string,
    @Query('page_size') pageSizeRaw?: string
  ) {
    return this.farmerOrderPage(card, pageRaw, pageSizeRaw);
  }

  @Get('farmer/orders')
  async farmerOrders(
    @Headers('x-farmer-card-token') card?: string,
    @Query('page') pageRaw?: string,
    @Query('page_size') pageSizeRaw?: string
  ) {
    return this.farmerOrderPage(card, pageRaw, pageSizeRaw);
  }

  private async farmerOrderPage(card?: string, pageRaw?: string, pageSizeRaw?: string) {
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSizeRaw ?? '20', 10) || 20));
    const user = await this.farmerFundService.resolvePortalUser(card?.trim() || null);
    const { rows, total } = await this.orderService.listUserOrdersPage(user.id, page, pageSize);
    return ok({
      items: rows.map((item) => this.mapOrderForPage(item)),
      total,
      page,
      page_size: pageSize
    });
  }
}

@Module({
  imports: [FarmerFundModule],
  controllers: [OrderController],
  providers: [OrderRepository, OrderService, OrderSettlementService],
  exports: [OrderRepository, OrderSettlementService]
})
export class OrderModule {}
