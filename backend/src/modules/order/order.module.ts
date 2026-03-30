import { Controller, Get, Headers, Module, Param, Post, Query } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { FarmerFundModule } from '../farmer-fund/farmer-fund.module';
import { FarmerFundService } from '../farmer-fund/farmer-fund.service';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Controller()
class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly farmerFundService: FarmerFundService
  ) {}

  private mapOrderForPage(order: {
    id: string;
    userDisplayName?: string | null;
    userMobile?: string | null;
    wellCode?: string | null;
    wellDisplayName?: string | null;
    billingPackageName?: string | null;
    unitType?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    chargeDurationSec?: number | null;
    chargeVolume?: number | null;
    amount: number;
    status: string;
    settlementStatus?: string | null;
    pricingDetail?: Record<string, unknown>;
  }) {
    const pricingDetail = (order.pricingDetail ?? {}) as Record<string, any>;
    const usage =
      order.chargeVolume ??
      Number(pricingDetail.usage?.volume ?? pricingDetail.usage?.duration_seconds ?? 0);
    const unit = String(pricingDetail.unit ?? order.unitType ?? 'minute');

    return {
      id: order.id,
      user: order.userDisplayName ?? '--',
      phone: order.userMobile ?? '--',
      well: order.wellDisplayName ?? order.wellCode ?? '--',
      billing: order.billingPackageName ?? '--',
      start_time: order.startedAt,
      end_time: order.endedAt,
      usage: Number(usage ?? 0),
      unit,
      amount: Number(order.amount ?? 0),
      status: order.settlementStatus === 'unpaid' || order.status === 'created' ? 'active' : 'completed'
    };
  }

  @Get('orders')
  async listOrders() {
    return ok({ items: (await this.orderService.listOrders()).map((item) => this.mapOrderForPage(item)) });
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    return ok(await this.orderService.getOrder(id));
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
  providers: [OrderRepository, OrderService],
  exports: [OrderRepository]
})
export class OrderModule {}
