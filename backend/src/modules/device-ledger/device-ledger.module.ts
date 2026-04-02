import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { SPATIAL_LOCATION_LAYERS_CONTRACT_V1 } from '../../common/location/spatial-location-semantics';
import {
  ArchiveLedgerDeviceDto,
  CreateLedgerDeviceDto,
  ListDevicesQueryDto,
  UpdateLedgerDeviceDto
} from './device-ledger.dto';
import { DeviceLedgerRepository } from './device-ledger.repository';
import { DeviceLedgerService } from './device-ledger.service';

@Controller('devices')
class DeviceLedgerController {
  constructor(private readonly service: DeviceLedgerService) {}

  @Get()
  async list(@Query() query: ListDevicesQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 20)));
    const { items, total } = await this.service.list({
      page,
      pageSize,
      projectId: query.project_id,
      assetId: query.asset_id,
      deviceTypeId: query.device_type_id,
      q: query.q
    });
    return ok({
      items,
      total,
      page,
      page_size: pageSize,
      spatial_location_contract: SPATIAL_LOCATION_LAYERS_CONTRACT_V1
    });
  }

  @Post()
  async create(@Body() dto: CreateLedgerDeviceDto) {
    const row = await this.service.create(dto);
    return ok(row);
  }

  @Get('display-status/options')
  displayStatusOptions() {
    return this.service.displayStatusOptions();
  }

  @Get('location-source-strategies/options')
  locationSourceStrategyOptions() {
    return this.service.locationSourceStrategyOptions();
  }

  @Get('spatial-location-contract')
  spatialLocationContract() {
    return ok({ spatial_location_contract: SPATIAL_LOCATION_LAYERS_CONTRACT_V1 });
  }

  @Get('comm-identity-types/options')
  commIdentityTypeOptions() {
    return this.service.commIdentityTypeOptions();
  }

  @Get(':id/telemetry')
  telemetry(@Param('id') id: string) {
    return ok({ id, telemetry: [] });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.service.getById(id));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateLedgerDeviceDto) {
    return ok(await this.service.update(id, dto));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.service.remove(id));
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string, @Body() dto: ArchiveLedgerDeviceDto) {
    return ok(await this.service.archive(id, dto));
  }
}

@Module({
  controllers: [DeviceLedgerController],
  providers: [DeviceLedgerRepository, DeviceLedgerService],
  exports: [DeviceLedgerRepository, DeviceLedgerService]
})
export class DeviceLedgerModule {}
