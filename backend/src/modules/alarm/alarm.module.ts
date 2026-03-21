import { Controller, Get, Module, Param, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

@Controller('alarms')
class AlarmController {
  @Get()
  list() {
    return ok({ items: [] });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return ok({ id });
  }

  @Post(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return ok({ id, status: 'acknowledged' });
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string) {
    return ok({ id, status: 'resolved' });
  }
}

@Module({
  controllers: [AlarmController]
})
export class AlarmModule {}
