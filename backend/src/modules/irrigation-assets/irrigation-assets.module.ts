import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateWellDto {
  deviceId: string;
  wellCode: string;
  waterSourceType: string;
}

interface CreatePumpDto {
  deviceId: string;
  wellId: string;
  pumpCode: string;
  ratedPowerKw: number;
}

interface CreateValveDto {
  deviceId: string;
  wellId: string;
  valveCode: string;
  valveKind: string;
}

@Controller()
class IrrigationAssetsController {
  @Get('wells')
  listWells() {
    return ok({ items: [] });
  }

  @Post('wells')
  createWell(@Body() dto: CreateWellDto) {
    return ok({ created: dto });
  }

  @Get('wells/:id')
  detailWell(@Param('id') id: string) {
    return ok({ id });
  }

  @Patch('wells/:id')
  updateWell(@Param('id') id: string, @Body() dto: Partial<CreateWellDto>) {
    return ok({ id, changes: dto });
  }

  @Get('pumps')
  listPumps() {
    return ok({ items: [] });
  }

  @Post('pumps')
  createPump(@Body() dto: CreatePumpDto) {
    return ok({ created: dto });
  }

  @Get('pumps/:id')
  detailPump(@Param('id') id: string) {
    return ok({ id });
  }

  @Patch('pumps/:id')
  updatePump(@Param('id') id: string, @Body() dto: Partial<CreatePumpDto>) {
    return ok({ id, changes: dto });
  }

  @Get('valves')
  listValves() {
    return ok({ items: [] });
  }

  @Post('valves')
  createValve(@Body() dto: CreateValveDto) {
    return ok({ created: dto });
  }

  @Get('valves/:id')
  detailValve(@Param('id') id: string) {
    return ok({ id });
  }

  @Patch('valves/:id')
  updateValve(@Param('id') id: string, @Body() dto: Partial<CreateValveDto>) {
    return ok({ id, changes: dto });
  }
}

@Module({
  controllers: [IrrigationAssetsController]
})
export class IrrigationAssetsModule {}
