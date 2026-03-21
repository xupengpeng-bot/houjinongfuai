import { Controller, Get, Module } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

@Controller('dashboard')
class DashboardController {
  @Get('overview')
  overview() {
    return ok({
      deviceSummary: {},
      orderSummary: {},
      alarmSummary: {},
      todoSummary: {}
    });
  }
}

@Module({
  controllers: [DashboardController]
})
export class DashboardModule {}
