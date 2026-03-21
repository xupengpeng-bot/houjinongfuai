import { Controller, Get, Module } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return ok({
      status: 'ok',
      service: 'houjinongfuai-backend',
      phase: 'phase-1',
      timestamp: new Date().toISOString()
    });
  }
}

@Module({
  controllers: [HealthController]
})
export class HealthModule {}
