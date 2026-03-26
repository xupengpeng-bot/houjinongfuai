import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Post,
  Put,
  Query
} from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  FORM_OPTION_POINT_TYPES,
  FORM_OPTION_STATUSES,
  MeteringPointRow,
  resolveMeteringTypeForUpdate,
  resolveMeteringTypeForWrite,
  toMeteringPointCompat
} from '../../common/contracts/lvb4021-compat';
import { DatabaseService } from '../../common/db/database.service';

export type { MeteringPointRow };

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const METERING_CODE_PREFIX = 'MP-HJ-';

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

interface CreateMeteringPointDto {
  point_name?: string;
  project_id?: string;
  block_id?: string;
  /** Canonical (DB). */
  metering_type?: string;
  /** LVB-4021 frontend alias; persisted as `metering_type`. */
  point_type?: string;
  asset_id?: string | null;
  primary_meter_device_id?: string | null;
  rated_capacity_kva?: number | null;
  status?: string;
  remarks?: string;
  tariff_plan_id?: string | null;
}

interface UpdateMeteringPointDto {
  point_name?: string;
  project_id?: string;
  block_id?: string;
  metering_type?: string;
  point_type?: string;
  asset_id?: string | null;
  primary_meter_device_id?: string | null;
  rated_capacity_kva?: number | null;
  status?: string;
  remarks?: string;
  tariff_plan_id?: string | null;
}

@Injectable()
class MeteringPointService {
  constructor(private readonly db: DatabaseService) {}

  private async generateMeteringCode(client: PoolClient) {
    const result = await this.db.query<{ next_code: string }>(
      `select $1 || lpad(nextval('metering_point_code_seq')::text, 3, '0') as next_code`,
      [METERING_CODE_PREFIX],
      client
    );
    return result.rows[0].next_code;
  }

  private async ensureProject(projectId: string, client?: PoolClient) {
    const r = await this.db.query<{ id: string }>(
      `select id from project where tenant_id = $1 and id = $2`,
      [TENANT_ID, projectId],
      client
    );
    if (!r.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { project_id: 'project_id is invalid' }
      });
    }
  }

  private async ensureBlockForProject(blockId: string, projectId: string, client?: PoolClient) {
    const r = await this.db.query<{ id: string }>(
      `
      select pb.id
      from project_block pb
      where pb.tenant_id = $1 and pb.id = $2 and pb.project_id = $3
      `,
      [TENANT_ID, blockId, projectId],
      client
    );
    if (!r.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { block_id: 'block_id is invalid for the selected project' }
      });
    }
  }

  private async ensureAssetInProject(assetId: string, projectId: string, client?: PoolClient) {
    const r = await this.db.query<{ id: string }>(
      `select id from asset where tenant_id = $1 and id = $2 and project_id = $3`,
      [TENANT_ID, assetId, projectId],
      client
    );
    if (!r.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { asset_id: 'asset_id is invalid for the selected project' }
      });
    }
  }

  private async ensureDevice(deviceId: string, client?: PoolClient) {
    const r = await this.db.query<{ id: string }>(
      `select id from device where tenant_id = $1 and id = $2`,
      [TENANT_ID, deviceId],
      client
    );
    if (!r.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { primary_meter_device_id: 'primary_meter_device_id is invalid' }
      });
    }
  }

  async list(page = 1, pageSize = 20, q?: string, projectId?: string) {
    const offset = (page - 1) * pageSize;
    const term = q?.trim();
    const params: unknown[] = [TENANT_ID];
    const where: string[] = ['mp.tenant_id = $1'];
    let n = 2;

    if (projectId?.trim()) {
      where.push(`mp.project_id = $${n}`);
      params.push(projectId.trim());
      n += 1;
    }
    if (term) {
      where.push(
        `(mp.metering_point_code ilike $${n} or mp.point_name ilike $${n + 1} or p.project_name ilike $${n + 2})`
      );
      const t = `%${term}%`;
      params.push(t, t, t);
      n += 3;
    }
    params.push(pageSize, offset);
    const lim = n;
    const off = n + 1;

    const sql = `
      select
        mp.id,
        mp.metering_point_code,
        mp.project_id,
        p.project_name,
        mp.block_id,
        pb.block_name,
        mp.asset_id,
        mp.primary_meter_device_id,
        mp.point_name,
        mp.metering_type,
        mp.rated_capacity_kva::text as rated_capacity_kva,
        mp.status,
        coalesce(mp.remarks, '') as remarks,
        mp.tariff_plan_id::text as tariff_plan_id,
        count(*) over()::text as total_count
      from metering_point mp
      join project p on p.id = mp.project_id and p.tenant_id = mp.tenant_id
      join project_block pb on pb.id = mp.block_id and pb.tenant_id = mp.tenant_id
      where ${where.join(' and ')}
      order by mp.created_at desc
      limit $${lim} offset $${off}
    `;

    const result = await this.db.query<MeteringPointRow & { total_count: string }>(sql, params);
    const items = result.rows.map(({ total_count, ...row }) => toMeteringPointCompat(row));
    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
    return { items, total, page, page_size: pageSize };
  }

  async options() {
    const result = await this.db.query<{
      value: string;
      label: string;
      metering_point_code: string;
      project_id: string;
      block_id: string;
    }>(
      `
      select
        mp.id as value,
        mp.point_name || ' (' || mp.metering_point_code || ')' as label,
        mp.metering_point_code,
        mp.project_id,
        mp.block_id
      from metering_point mp
      where mp.tenant_id = $1
      order by mp.point_name asc
      `,
      [TENANT_ID]
    );
    return result.rows;
  }

  async formOptions(projectId?: string, q?: string) {
    const pid = projectId?.trim();
    const term = q?.trim();
    const t = term ? `%${term}%` : null;

    const projectsParams: unknown[] = [TENANT_ID];
    let projectsWhere = 'p.tenant_id = $1';
    let pn = 2;
    if (t) {
      projectsWhere += ` and (p.project_name ilike $${pn} or p.project_code ilike $${pn + 1})`;
      projectsParams.push(t, t);
      pn += 2;
    }
    const projects = await this.db.query(
      `
      select p.id as value, p.project_name as label, p.project_code, p.region_id::text as region_id
      from project p
      where ${projectsWhere}
      order by p.project_name asc
      `,
      projectsParams
    );

    const blocksParams: unknown[] = [TENANT_ID];
    let blocksWhere = 'pb.tenant_id = $1';
    let bn = 2;
    if (pid) {
      blocksWhere += ` and pb.project_id = $${bn}`;
      blocksParams.push(pid);
      bn += 1;
    }
    if (t) {
      blocksWhere += ` and (pb.block_name ilike $${bn} or pb.block_code ilike $${bn + 1})`;
      blocksParams.push(t, t);
      bn += 2;
    }
    const blocks = await this.db.query(
      `
      select pb.id as value, pb.block_name as label, pb.block_code, pb.project_id
      from project_block pb
      where ${blocksWhere}
      order by pb.block_name asc
      limit 500
      `,
      blocksParams
    );

    const assetsParams: unknown[] = [TENANT_ID];
    let assetsWhere = 'a.tenant_id = $1';
    let an = 2;
    if (pid) {
      assetsWhere += ` and a.project_id = $${an}`;
      assetsParams.push(pid);
      an += 1;
    }
    if (t) {
      assetsWhere += ` and (a.asset_name ilike $${an} or a.asset_code ilike $${an + 1})`;
      assetsParams.push(t, t);
      an += 2;
    }
    const assets = await this.db.query(
      `
      select a.id as value, a.asset_name as label, a.asset_code, a.project_id
      from asset a
      where ${assetsWhere}
      order by a.asset_name asc
      limit 500
      `,
      assetsParams
    );

    const devicesParams: unknown[] = [TENANT_ID];
    let devicesWhere = 'd.tenant_id = $1';
    let dn = 2;
    if (pid) {
      devicesWhere += ` and d.region_id = (select p.region_id from project p where p.tenant_id = $1 and p.id = $${dn}::uuid)`;
      devicesParams.push(pid);
      dn += 1;
    }
    if (t) {
      devicesWhere += ` and (d.device_code ilike $${dn} or coalesce(d.device_name, '') ilike $${dn + 1} or coalesce(d.serial_no, '') ilike $${dn + 2})`;
      devicesParams.push(t, t, t);
      dn += 3;
    }
    const devices = await this.db.query(
      `
      select d.id as value,
        coalesce(nullif(trim(d.device_name), ''), d.device_code) as label,
        d.device_code,
        coalesce(d.serial_no, '') as serial_no,
        d.region_id::text as region_id
      from device d
      where ${devicesWhere}
      order by d.device_code asc
      limit 500
      `,
      devicesParams
    );

    return {
      projects: projects.rows,
      blocks: blocks.rows,
      assets: assets.rows,
      devices: devices.rows,
      point_types: FORM_OPTION_POINT_TYPES,
      statuses: FORM_OPTION_STATUSES
    };
  }

  private async loadMeteringPointRow(id: string): Promise<MeteringPointRow> {
    const result = await this.db.query<MeteringPointRow>(
      `
      select
        mp.id,
        mp.metering_point_code,
        mp.project_id,
        p.project_name,
        mp.block_id,
        pb.block_name,
        mp.asset_id,
        mp.primary_meter_device_id,
        mp.point_name,
        mp.metering_type,
        mp.rated_capacity_kva::text as rated_capacity_kva,
        mp.status,
        coalesce(mp.remarks, '') as remarks,
        mp.tariff_plan_id::text as tariff_plan_id
      from metering_point mp
      join project p on p.id = mp.project_id and p.tenant_id = mp.tenant_id
      join project_block pb on pb.id = mp.block_id and pb.tenant_id = mp.tenant_id
      where mp.tenant_id = $1 and mp.id = $2
      `,
      [TENANT_ID, id]
    );
    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.NOT_FOUND, 'TARGET_NOT_FOUND', 'Metering point not found', { id });
    }
    return row;
  }

  async getById(id: string) {
    const row = await this.loadMeteringPointRow(id);
    return toMeteringPointCompat(row);
  }

  async create(dto: CreateMeteringPointDto) {
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'metering_point_code')) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'metering_point_code', message: 'metering_point_code must not be provided' }]
      });
    }
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'point_code')) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'point_code', message: 'point_code must not be provided' }]
      });
    }
    if (!dto.point_name?.trim()) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'point_name', message: 'point_name is required' }]
      });
    }
    const resolvedType = resolveMeteringTypeForWrite(dto);
    if (!dto.project_id?.trim() || !dto.block_id?.trim() || !resolvedType?.trim()) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [
          {
            field: 'project_id,block_id,metering_type|point_type',
            message: 'project_id, block_id and metering_type (or point_type) are required'
          }
        ]
      });
    }

    const id = await this.db.withTransaction(async (client) => {
      const projectId = dto.project_id!.trim();
      const blockId = dto.block_id!.trim();
      await this.ensureProject(projectId, client);
      await this.ensureBlockForProject(blockId, projectId, client);
      if (dto.asset_id?.trim()) {
        await this.ensureAssetInProject(dto.asset_id.trim(), projectId, client);
      }
      if (dto.primary_meter_device_id?.trim()) {
        await this.ensureDevice(dto.primary_meter_device_id.trim(), client);
      }

      const code = await this.generateMeteringCode(client);
      const inserted = await this.db.query<{ id: string }>(
        `
        insert into metering_point (
          tenant_id, metering_point_code, project_id, block_id, asset_id, primary_meter_device_id,
          point_name, metering_type, rated_capacity_kva, status, remarks, tariff_plan_id
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        returning id
        `,
        [
          TENANT_ID,
          code,
          projectId,
          blockId,
          dto.asset_id?.trim() || null,
          dto.primary_meter_device_id?.trim() || null,
          dto.point_name!.trim(),
          resolvedType!.trim(),
          dto.rated_capacity_kva ?? null,
          dto.status ?? 'draft',
          dto.remarks?.trim() ?? '',
          dto.tariff_plan_id?.trim() || null
        ],
        client
      );
      return inserted.rows[0].id;
    });

    return this.getById(id);
  }

  async update(id: string, dto: UpdateMeteringPointDto) {
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'metering_point_code')) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'metering_point_code', message: 'metering_point_code cannot be updated' }]
      });
    }
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'point_code')) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'point_code', message: 'point_code cannot be updated' }]
      });
    }

    const existing = await this.loadMeteringPointRow(id);
    const nextProjectId = dto.project_id?.trim() ?? existing.project_id;
    const nextBlockId = dto.block_id?.trim() ?? existing.block_id;
    const nextMeteringType = resolveMeteringTypeForUpdate(dto, existing);

    await this.db.withTransaction(async (client) => {
      await this.ensureProject(nextProjectId, client);
      await this.ensureBlockForProject(nextBlockId, nextProjectId, client);
      const nextAsset = dto.asset_id !== undefined ? dto.asset_id?.trim() || null : existing.asset_id;
      if (nextAsset) {
        await this.ensureAssetInProject(nextAsset, nextProjectId, client);
      }
      const nextDevice =
        dto.primary_meter_device_id !== undefined
          ? dto.primary_meter_device_id?.trim() || null
          : existing.primary_meter_device_id;
      if (nextDevice) {
        await this.ensureDevice(nextDevice, client);
      }

      await this.db.query(
        `
        update metering_point
        set
          project_id = $3,
          block_id = $4,
          asset_id = $5,
          primary_meter_device_id = $6,
          point_name = $7,
          metering_type = $8,
          rated_capacity_kva = $9,
          status = $10,
          remarks = $11,
          tariff_plan_id = $12,
          updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          nextProjectId,
          nextBlockId,
          nextAsset,
          nextDevice,
          dto.point_name?.trim() ?? existing.point_name,
          nextMeteringType,
          dto.rated_capacity_kva !== undefined ? dto.rated_capacity_kva : existing.rated_capacity_kva,
          dto.status ?? existing.status,
          dto.remarks !== undefined ? dto.remarks?.trim() ?? '' : existing.remarks,
          dto.tariff_plan_id !== undefined ? dto.tariff_plan_id?.trim() || null : existing.tariff_plan_id
        ],
        client
      );
    });

    return this.getById(id);
  }
}

@Controller('metering-points')
class MeteringPointController {
  constructor(private readonly service: MeteringPointService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('q') q?: string,
    @Query('project_id') projectId?: string
  ) {
    return this.service.list(parsePage(page), parsePageSize(pageSize), q, projectId);
  }

  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('form-options')
  formOptions(@Query('project_id') projectId?: string, @Query('q') q?: string) {
    return this.service.formOptions(projectId, q);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  create(@Body() dto: CreateMeteringPointDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMeteringPointDto) {
    return this.service.update(id, dto);
  }
}

@Module({
  controllers: [MeteringPointController],
  providers: [MeteringPointService]
})
export class MeteringPointModule {}
