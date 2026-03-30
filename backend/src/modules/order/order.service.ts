import { Injectable } from '@nestjs/common';
import { OrderRepository } from './order.repository';

@Injectable()
export class OrderService {
  constructor(private readonly orderRepository: OrderRepository) {}

  listOrders() {
    return this.orderRepository.findAll();
  }

  getOrder(id: string) {
    return this.orderRepository.findById(id);
  }

  listUserOrders(userId: string) {
    return this.orderRepository.findByUserId(userId);
  }

  listUserOrdersPage(userId: string, page: number, pageSize: number) {
    return this.orderRepository.findByUserIdPage(userId, page, pageSize);
  }

  /** 门户用水记录：与 Runtime 使用同一默认农户，避免硬编码 UUID 与库内排序不一致 */
  async listOrdersForDefaultFarmerUser() {
    const userId = await this.orderRepository.findDefaultFarmerUserId();
    if (!userId) {
      return [];
    }
    return this.orderRepository.findByUserId(userId);
  }
}
