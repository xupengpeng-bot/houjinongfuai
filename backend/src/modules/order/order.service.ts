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
}
