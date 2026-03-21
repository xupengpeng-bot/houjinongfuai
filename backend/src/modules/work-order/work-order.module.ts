import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateWorkOrderDto {
  sourceAlarmId?: string;
  sourceSessionId?: string;
  workOrderType: string;
  assigneeUserId?: string;
}

@Controller()
class WorkOrderController {
  @Get('work-orders')
  list() {
    return ok({ items: [] });
  }

  @Post('work-orders')
  create(@Body() dto: CreateWorkOrderDto) {
    return ok({ created: dto });
  }

  @Get('work-orders/:id')
  detail(@Param('id') id: string) {
    return ok({ id });
  }

  @Post('work-orders/:id/assign')
  assign(@Param('id') id: string) {
    return ok({ id, status: 'assigned' });
  }

  @Post('work-orders/:id/accept')
  accept(@Param('id') id: string) {
    return ok({ id, status: 'accepted' });
  }

  @Post('work-orders/:id/process')
  process(@Param('id') id: string) {
    return ok({ id, status: 'processing' });
  }

  @Get('m/my/todos')
  todos() {
    return ok({ items: [] });
  }

  @Get('m/my/work-orders')
  myWorkOrders() {
    return ok({ items: [] });
  }
}

@Module({
  controllers: [WorkOrderController]
})
export class WorkOrderModule {}
