import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const RUNNING_SESSION_STATUSES = ['pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping'];

interface WellPayload {
  name?: string;
  area?: string;
  depth?: number;
  pump_model?: string;
  flow_rate?: number;
  status?: 'running' | 'idle' | 'maintenance';
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

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException({ requestId: 'local-dev', code, message, data }, status);
}

function parsePage(value?: string, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value?: string, fallback = 20) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeWellStatus(value?: string) {
  if (value === 'running' || value === 'maintenance') return value;
  return 'idle';
}

function buildCode(prefix: string, name: string) {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${prefix}-${slug || 'AUTO'}-${Date.now().toString().slice(-6)}`;
}

@Injectable()
class IrrigationAssetsService {
  constructor(private readonly db: DatabaseService) {}

  private validateWellPayload(dto: WellPayload, isCreate: boolean) {
    const fieldErrors: Record<string, string[]> = {};
    if (isCreate && !dto.name?.trim()) fieldErrors.name = ['name is required'];
    if (isCreate && !dto.area?.trim()) fieldErrors.area = ['area is required'];
    if (dto.depth !== undefined && Number(dto.depth) < 0) fieldErrors.depth = ['depth must be >= 0'];
    if (dto.flow_rate !== undefined && Number(dto.flow_rate) < 0) fieldErrors.flow_rate = ['flow_rate must be >= 0'];
    if (dto.status && !['running', 'idle', 'maintenance'].includes(dto.status)) {
      fieldErrors.status = ['status is invalid'];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }
  }

  private async resolveRegionId(area: string, client?: PoolClient) {
    const trimmed = area.trim();
    const exact = await this.db.query<{ id: string }>(
      `
      select id
      from region
      where tenant_id = $1 and lower(region_name) = lower($2)
      order by created_at asc
      limit 1
      `,
      [TENANT_ID, trimmed],
      client
    );
    if (exact.rows[0]) return exact.rows[0].id;

    const fuzzy = await this.db.query<{ id: string }>(
      `
      select id
      from region
      where tenant_id = $1 and region_name ilike $2
      order by
        case
          when region_type = 'village' then 0
          when region_type = 'town' then 1
          when region_type = 'county' then 2
          else 3
        end,
        created_at asc
      limit 1
      `,
      [TENANT_ID, `%${trimmed}%`],
      client
    );
    if (fuzzy.rows[0]) return fuzzy.rows[0].id;

    const fallback = await this.db.query<{ id: string }>(
      `
      select id
      from region
      where tenant_id = $1
      order by
        case
          when region_type = 'village' then 0
          when region_type = 'town' then 1
          when region_type = 'county' then 2
          else 3
        end,
        created_at asc
      limit 1
      `,
      [TENANT_ID],
      client
    );
    if (!fallback.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { area: ['area is invalid'] }
      });
    }
    return fallback.rows[0].id;
  }

  private async getWellDeviceTypeId(client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from device_type
      where tenant_id = $1 and family = 'well'
      order by created_at asc
      limit 1
      `,
      [TENANT_ID],
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.CONFLICT, 'DEPENDENCY_MISSING', 'Well device type is missing');
    }
    return result.rows[0].id;
  }

  private buildWellReadQuery(extraWhere = '', extraParamsOffset = 3) {
    return `
      select
        w.id,
        w.device_id,
        w.well_code,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as name,
        coalesce(w.safety_profile_json->>'areaName', r.region_name) as area,
        coalesce((w.safety_profile_json->>'depthMeters')::numeric, 0) as depth,
        coalesce(
          w.safety_profile_json->>'pumpModel',
          pd.ext_json->>'model',
          pd.device_name,
          p.pump_code,
          ''
        ) as pump_model,
        coalesce((w.safety_profile_json->>'flowRate')::numeric, w.rated_flow, 0) as flow_rate,
        case
          when exists (
            select 1
            from runtime_session rs
            where rs.well_id = w.id
              and rs.status = any($${extraParamsOffset}::text[])
          ) then 'running'
          when coalesce(w.safety_profile_json->>'uiStatus', '') = 'running' then 'running'
          when coalesce(w.safety_profile_json->>'uiStatus', '') = 'maintenance' then 'maintenance'
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
      where w.tenant_id = $1
      ${extraWhere}
    `;
  }

  private mapWellRow(row: Record<string, any>) {
    return {
      id: row.id,
      name: row.name,
      area: row.area,
      depth: Number(row.depth ?? 0),
      pump_model: row.pump_model ?? '',
      flow_rate: Number(row.flow_rate ?? 0),
      status: normalizeWellStatus(row.status),
      daily_usage: Number(row.daily_usage ?? 0),
      monthly_usage: Number(row.monthly_usage ?? 0)
    };
  }

  private async fetchWellRecord(id: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        w.id,
        w.device_id,
        w.well_code,
        w.rated_flow,
        w.safety_profile_json,
        wd.region_id,
        wd.device_name,
        wd.online_state,
        wd.lifecycle_state
      from well w
      join device wd on wd.id = w.device_id
      where w.tenant_id = $1 and w.id = $2
      `,
      [TENANT_ID, id],
      client
    );
    return result.rows[0] ?? null;
  }

  async listWells(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<Record<string, any>>(
      `
      select
        w.id,
        w.device_id,
        w.well_code,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as name,
        coalesce(w.safety_profile_json->>'areaName', r.region_name) as area,
        coalesce((w.safety_profile_json->>'depthMeters')::numeric, 0) as depth,
        coalesce(
          w.safety_profile_json->>'pumpModel',
          pd.ext_json->>'model',
          pd.device_name,
          p.pump_code,
          ''
        ) as pump_model,
        coalesce((w.safety_profile_json->>'flowRate')::numeric, w.rated_flow, 0) as flow_rate,
        case
          when exists (
            select 1
            from runtime_session rs
            where rs.well_id = w.id
              and rs.status = any($4::text[])
          ) then 'running'
          when coalesce(w.safety_profile_json->>'uiStatus', '') = 'running' then 'running'
          when coalesce(w.safety_profile_json->>'uiStatus', '') = 'maintenance' then 'maintenance'
          when wd.lifecycle_state <> 'active' or wd.online_state <> 'online' then 'maintenance'
          else 'idle'
        end as status,
        coalesce((w.safety_profile_json->>'dailyUsage')::numeric, 0) as daily_usage,
        coalesce((w.safety_profile_json->>'monthlyUsage')::numeric, 0) as monthly_usage,
        count(*) over()::int as total_count
      from well w
      join device wd on wd.id = w.device_id
      join region r on r.id = wd.region_id
      left join pump p on p.well_id = w.id
      left join device pd on pd.id = p.device_id
      where w.tenant_id = $1
      order by w.created_at asc
      limit $2 offset $3
      `,
      [TENANT_ID, pageSize, offset, RUNNING_SESSION_STATUSES]
    );
    return {
      items: result.rows.map((row) => this.mapWellRow(row)),
      total: result.rows[0]?.total_count ?? 0,
      page,
      page_size: pageSize
    };
  }

  async detailWell(id: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      ${this.buildWellReadQuery('and w.id = $2', 3)}
      order by w.created_at asc
      limit 1
      `,
      [TENANT_ID, id, RUNNING_SESSION_STATUSES],
      client
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('well not found');
    return this.mapWellRow(row);
  }

  async getWellDevices(id: string) {
    const exists = await this.fetchWellRecord(id);
    if (!exists) throw new NotFoundException('well not found');
    const result = await this.db.query<Record<string, any>>(
      `
      select
        d.id,
        d.device_code,
        d.device_name,
        dt.type_name as device_type_name,
        dt.family,
        d.online_state,
        d.lifecycle_state
      from device d
      join device_type dt on dt.id = d.device_type_id
      where d.id = (select device_id from well where id = $1)

      union all

      select
        d.id,
        d.device_code,
        d.device_name,
        dt.type_name as device_type_name,
        dt.family,
        d.online_state,
        d.lifecycle_state
      from pump p
      join device d on d.id = p.device_id
      join device_type dt on dt.id = d.device_type_id
      where p.well_id = $1

      union all

      select
        d.id,
        d.device_code,
        d.device_name,
        dt.type_name as device_type_name,
        dt.family,
        d.online_state,
        d.lifecycle_state
      from valve v
      join device d on d.id = v.device_id
      join device_type dt on dt.id = d.device_type_id
      where v.well_id = $1
      `,
      [id]
    );
    return result.rows.map((row) => ({
      id: row.id,
      device_code: row.device_code,
      device_name: row.device_name,
      device_type_name: row.device_type_name,
      family: row.family,
      online_state: row.online_state,
      lifecycle_state: row.lifecycle_state
    }));
  }

  async createWell(dto: WellPayload) {
    this.validateWellPayload(dto, true);
    const createdId = await this.db.withTransaction(async (client) => {
      const status = normalizeWellStatus(dto.status);
      const regionId = await this.resolveRegionId(dto.area!.trim(), client);
      const wellTypeId = await this.getWellDeviceTypeId(client);
      const wellName = dto.name!.trim();
      const wellCode = buildCode('WELL', wellName);
      const deviceCode = buildCode('DEV-WELL', wellName);

      const deviceInserted = await this.db.query<{ id: string }>(
        `
        insert into device (
          tenant_id,
          device_type_id,
          region_id,
          device_code,
          device_name,
          online_state,
          lifecycle_state,
          runtime_state,
          ext_json
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        returning id
        `,
        [
          TENANT_ID,
          wellTypeId,
          regionId,
          deviceCode,
          `${wellName} Controller`,
          status === 'maintenance' ? 'offline' : 'online',
          status === 'maintenance' ? 'maintenance' : 'active',
          status === 'running' ? 'running' : 'idle',
          JSON.stringify({ source: 'ops-well-form' })
        ],
        client
      );

      const wellInserted = await this.db.query<{ id: string }>(
        `
        insert into well (
          tenant_id,
          device_id,
          well_code,
          water_source_type,
          rated_flow,
          safety_profile_json
        ) values ($1, $2, $3, 'groundwater', $4, $5::jsonb)
        returning id
        `,
        [
          TENANT_ID,
          deviceInserted.rows[0].id,
          wellCode,
          Number(dto.flow_rate ?? 0),
          JSON.stringify({
            displayName: wellName,
            areaName: dto.area!.trim(),
            depthMeters: Number(dto.depth ?? 0),
            flowRate: Number(dto.flow_rate ?? 0),
            pumpModel: dto.pump_model?.trim() ?? '',
            dailyUsage: 0,
            monthlyUsage: 0,
            uiStatus: status
          })
        ],
        client
      );
      return wellInserted.rows[0].id;
    });

    return this.detailWell(createdId);
  }

  async updateWell(id: string, dto: WellPayload) {
    this.validateWellPayload(dto, false);
    const existing = await this.fetchWellRecord(id);
    if (!existing) throw new NotFoundException('well not found');

    await this.db.withTransaction(async (client) => {
      const existingProfile = (existing.safety_profile_json ?? {}) as Record<string, unknown>;
      const area = dto.area?.trim() || String(existingProfile.areaName ?? '');
      const regionId = area ? await this.resolveRegionId(area, client) : existing.region_id;
      const status = normalizeWellStatus(dto.status ?? String(existingProfile.uiStatus ?? 'idle'));
      const flowRate = Number(dto.flow_rate ?? existing.rated_flow ?? existingProfile.flowRate ?? 0);

      await this.db.query(
        `
        update device
        set region_id = $3,
            device_name = $4,
            online_state = $5,
            lifecycle_state = $6,
            runtime_state = $7,
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          existing.device_id,
          regionId,
          `${(dto.name?.trim() || String(existingProfile.displayName ?? existing.device_name))} Controller`,
          status === 'maintenance' ? 'offline' : 'online',
          status === 'maintenance' ? 'maintenance' : 'active',
          status === 'running' ? 'running' : 'idle'
        ],
        client
      );

      await this.db.query(
        `
        update well
        set rated_flow = $3,
            safety_profile_json = $4::jsonb,
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          flowRate,
          JSON.stringify({
            ...existingProfile,
            displayName: dto.name?.trim() || existingProfile.displayName || existing.well_code,
            areaName: area || existingProfile.areaName || '',
            depthMeters: Number(dto.depth ?? existingProfile.depthMeters ?? 0),
            flowRate,
            pumpModel: dto.pump_model?.trim() ?? existingProfile.pumpModel ?? '',
            dailyUsage: Number(existingProfile.dailyUsage ?? 0),
            monthlyUsage: Number(existingProfile.monthlyUsage ?? 0),
            uiStatus: status
          })
        ],
        client
      );
    });

    return this.detailWell(id);
  }

  async removeWell(id: string) {
    const existing = await this.fetchWellRecord(id);
    if (!existing) throw new NotFoundException('well not found');

    const dependencyChecks = await this.db.query<Record<string, any>>(
      `
      select
        (select count(*)::int from pump where well_id = $1) as pump_count,
        (select count(*)::int from valve where well_id = $1) as valve_count,
        (select count(*)::int from well_runtime_policy where well_id = $1) as policy_count,
        (select count(*)::int from runtime_container where well_id = $1) as container_count,
        (select count(*)::int from runtime_session where well_id = $1) as session_count
      `,
      [id]
    );
    const deps = dependencyChecks.rows[0];
    const hasDependencies =
      Number(deps?.pump_count ?? 0) > 0 ||
      Number(deps?.valve_count ?? 0) > 0 ||
      Number(deps?.policy_count ?? 0) > 0 ||
      Number(deps?.container_count ?? 0) > 0 ||
      Number(deps?.session_count ?? 0) > 0;

    if (hasDependencies) {
      throw appException(HttpStatus.CONFLICT, 'DELETE_BLOCKED', 'Delete blocked', {
        id,
        reason: 'well has dependent pumps, valves, runtime, or policy records'
      });
    }

    await this.db.withTransaction(async (client) => {
      await this.db.query(`delete from well where tenant_id = $1 and id = $2`, [TENANT_ID, id], client);
      await this.db.query(`delete from device where tenant_id = $1 and id = $2`, [TENANT_ID, existing.device_id], client);
    });
  }
}

@Controller()
class IrrigationAssetsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly irrigationAssetsService: IrrigationAssetsService
  ) {}

  @Get('wells')
  async listWells(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return ok(await this.irrigationAssetsService.listWells(parsePage(page), parsePageSize(pageSize)));
  }

  @Post('wells')
  async createWell(@Body() dto: WellPayload) {
    return ok(await this.irrigationAssetsService.createWell(dto));
  }

  @Get('wells/:id')
  async detailWell(@Param('id') id: string) {
    return ok(await this.irrigationAssetsService.detailWell(id));
  }

  @Get('wells/:id/devices')
  async getWellDevices(@Param('id') id: string) {
    return ok(await this.irrigationAssetsService.getWellDevices(id));
  }

  @Put('wells/:id')
  async updateWell(@Param('id') id: string, @Body() dto: WellPayload) {
    return ok(await this.irrigationAssetsService.updateWell(id, dto));
  }

  @Delete('wells/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeWell(@Param('id') id: string) {
    await this.irrigationAssetsService.removeWell(id);
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

  @Put('pumps/:id')
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

  @Put('valves/:id')
  updateValve(@Param('id') id: string, @Body() dto: Partial<CreateValveDto>) {
    return ok({ id, changes: dto });
  }
}

@Module({
  controllers: [IrrigationAssetsController],
  providers: [IrrigationAssetsService]
})
export class IrrigationAssetsModule {}
