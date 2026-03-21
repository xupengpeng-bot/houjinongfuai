import { Controller, Get, Module, Param, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Controller()
class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get('orders')
  async listOrders() {
    return ok({ items: await this.orderService.listOrders() });
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
    return ok({ items: await this.orderService.listUserOrders('00000000-0000-0000-0000-000000000101') });
  }
}

@Module({
  controllers: [OrderController],
  providers: [OrderRepository, OrderService],
  exports: [OrderRepository]
})
export class OrderModule {}
