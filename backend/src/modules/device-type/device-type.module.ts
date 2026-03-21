import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateDeviceTypeDto {
  typeCode: string;
  typeName: string;
  family: string;
  capabilityJson?: Record<string, unknown>;
  defaultConfigJson?: Record<string, unknown>;
}

@Controller('device-types')
class DeviceTypeController {
  @Get()
  list() {
    return ok({ items: [] });
  }

  @Post()
  create(@Body() dto: CreateDeviceTypeDto) {
    return ok({ created: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateDeviceTypeDto>) {
    return ok({ id, changes: dto });
  }
}

@Module({
  controllers: [DeviceTypeController]
})
export class DeviceTypeModule {}
