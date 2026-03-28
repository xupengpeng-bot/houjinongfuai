import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
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
  constructor(private readonly db: DatabaseService) {}

  @Get('wells')
  async listWells() {
    const result = await this.db.query(`
      select
        w.id,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as name,
        r.region_name as area,
        coalesce((w.safety_profile_json->>'depthMeters')::numeric, 0) as depth,
        coalesce(pd.ext_json->>'model', pd.device_name, p.pump_code) as pump_model,
        coalesce((w.safety_profile_json->>'flowRate')::numeric, w.rated_flow, 0) as flow_rate,
        case
          when exists (
            select 1
            from runtime_session rs
            where rs.well_id = w.id
              and rs.status in ('pending_start', 'running', 'billing', 'stopping')
          ) then 'running'
          when wd.lifecycle_state <> 'active' or wd.online_state <> 'online' then 'maintenance'
          else 'idle'
        end as status,
        coalesce((w.safety_profile_json->>'dailyUsage')::numeric, 0) as daily_usage,
        coalesce((w.safety_profile_json->>'monthlyUsage')::numeric, 0) as monthly_usage
      from well w
      join device wd on wd.id = w.device_id
      join region r on r.id = wd.region_id
      left join pump p on p.well_id = w.id
      left join device pd on pd.id = p.device_id
      order by w.created_at asc
    `);
    return ok({ items: result.rows });
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
  async listPumps() {
    const result = await this.db.query(`
      select
        p.id,
        p.pump_code as code,
        coalesce(d.device_name, p.pump_code) as name,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as well,
        p.rated_power_kw as rated_power_kw,
        d.online_state,
        d.lifecycle_state
      from pump p
      join well w on w.id = p.well_id
      join device d on d.id = p.device_id
      order by p.created_at asc
    `);
    return ok({ items: result.rows });
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
  async listValves() {
    const result = await this.db.query(`
      select
        v.id,
        v.valve_code as code,
        coalesce(d.device_name, v.valve_code) as name,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as well,
        v.valve_kind as kind,
        d.online_state,
        d.lifecycle_state
      from valve v
      join well w on w.id = v.well_id
      join device d on d.id = v.device_id
      order by v.created_at asc
    `);
    return ok({ items: result.rows });
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
