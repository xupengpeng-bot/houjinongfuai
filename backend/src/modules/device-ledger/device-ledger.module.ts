import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateDeviceDto {
  deviceTypeId: string;
  regionId: string;
  deviceCode: string;
  deviceName: string;
  serialNo?: string;
  protocolType?: string;
}

@Controller('devices')
class DeviceLedgerController {
  @Get()
  list() {
    return ok({ items: [] });
  }

  @Post()
  create(@Body() dto: CreateDeviceDto) {
    return ok({ created: dto });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return ok({ id });
  }

  @Get(':id/telemetry')
  telemetry(@Param('id') id: string) {
    return ok({ id, telemetry: [] });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateDeviceDto>) {
    return ok({ id, changes: dto });
  }
}

@Module({
  controllers: [DeviceLedgerController]
})
export class DeviceLedgerModule {}
