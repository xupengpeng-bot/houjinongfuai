import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import {
  CreateDeviceRelationDto,
  ListDeviceRelationsQueryDto,
  UpdateDeviceRelationDto
} from './device-relations.dto';
import { DeviceRelationsRepository } from './device-relations.repository';
import { DeviceRelationsService } from './device-relations.service';

@Controller('device-relations')
class DeviceRelationsController {
  constructor(private readonly service: DeviceRelationsService) {}

  @Get('relation-types/options')
  relationTypeOptions() {
    return ok({ items: this.service.relationTypeOptions() });
  }

  @Get('sequence-rules/options')
  sequenceRuleOptions() {
    return ok({ items: this.service.sequenceRuleOptions() });
  }

  @Get('source-devices/options')
  async sourceDeviceOptions() {
    return ok({ items: await this.service.sourceDeviceOptions() });
  }

  @Get('target-devices/options')
  async targetDeviceOptions() {
    return ok({ items: await this.service.targetDeviceOptions() });
  }

  @Get()
  async list(@Query() query: ListDeviceRelationsQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 20)));
    const { items, total } = await this.service.list(page, pageSize);
    return ok({ items, total, page, page_size: pageSize });
  }

  @Post()
  async create(@Body() dto: CreateDeviceRelationDto) {
    return ok(await this.service.create(dto));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.service.getById(id));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDeviceRelationDto) {
    return ok(await this.service.update(id, dto));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.service.remove(id));
  }
}

@Module({
  controllers: [DeviceRelationsController],
  providers: [DeviceRelationsRepository, DeviceRelationsService],
  exports: [DeviceRelationsRepository, DeviceRelationsService]
})
export class DeviceRelationsModule {}
