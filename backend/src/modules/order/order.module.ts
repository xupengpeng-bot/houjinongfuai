import { Controller, Get, Module, Param, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Controller()
class OrderController {
  constructor(private readonly orderService: OrderService) {}

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
  async userOrders() {
    return ok({ items: (await this.orderService.listUserOrders('00000000-0000-0000-0000-000000000101')).map((item) => this.mapOrderForPage(item)) });
  }

  @Get('farmer/orders')
  async farmerOrders() {
    return ok({ items: (await this.orderService.listUserOrders('00000000-0000-0000-0000-000000000101')).map((item) => this.mapOrderForPage(item)) });
  }
}

@Module({
  controllers: [OrderController],
  providers: [OrderRepository, OrderService],
  exports: [OrderRepository]
})
export class OrderModule {}
