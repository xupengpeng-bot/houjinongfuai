import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  HttpException,
  Injectable,
  Module,
  Param,
  Post,
  Put,
  Query
} from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  ProjectBlockRow,
  resolveAreaSizeForWrite,
  toProjectBlockCompat
} from '../../common/contracts/lvb4021-compat';
import { DatabaseService } from '../../common/db/database.service';
import { CreateProjectBlockDto, UpdateProjectBlockDto } from './project-block.dto';

export type { ProjectBlockRow };

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const BLOCK_CODE_PREFIX = 'BLK-HJ-';

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

@Injectable()
class ProjectBlockService {
  constructor(private readonly db: DatabaseService) {}

  private async generateBlockCode(client: PoolClient) {
    const result = await this.db.query<{ next_code: string }>(
      `select $1 || lpad(nextval('block_code_seq')::text, 3, '0') as next_code`,
      [BLOCK_CODE_PREFIX],
      client
    );
    return result.rows[0].next_code;
  }

  private async ensureProjectExists(projectId: string, client?: PoolClient) {
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

  async list(page = 1, pageSize = 20, q?: string) {
    const offset = (page - 1) * pageSize;
    const term = q?.trim();
    const baseSelect = `
      select
        pb.id,
        pb.block_code,
        pb.project_id,
        p.project_name,
        pb.block_name,
        pb.center_latitude::text as center_latitude,
        pb.center_longitude::text as center_longitude,
        pb.area_size::text as area_size,
        pb.priority,
        pb.status,
        coalesce(pb.remarks, '') as remarks,
        count(*) over()::text as total_count
      from project_block pb
      join project p on p.id = pb.project_id and p.tenant_id = pb.tenant_id
      where pb.tenant_id = $1
    `;
    const result = term
      ? await this.db.query<ProjectBlockRow & { total_count: string }>(
          `${baseSelect}
        and (pb.block_code ilike $4 or pb.block_name ilike $5 or p.project_name ilike $6)
      order by pb.created_at desc
      limit $2 offset $3`,
          [TENANT_ID, pageSize, offset, `%${term}%`, `%${term}%`, `%${term}%`]
        )
      : await this.db.query<ProjectBlockRow & { total_count: string }>(
          `${baseSelect}
      order by pb.created_at desc
      limit $2 offset $3`,
          [TENANT_ID, pageSize, offset]
        );

    const items = result.rows.map(({ total_count, ...row }) => toProjectBlockCompat(row));
    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
    return { items, total, page, page_size: pageSize };
  }

  async options(projectId?: string, q?: string) {
    const pid = projectId?.trim();
    const term = q?.trim();
    const params: unknown[] = [TENANT_ID];
    const where: string[] = ['pb.tenant_id = $1', 'p.tenant_id = pb.tenant_id'];
    let n = 2;
    if (pid) {
      where.push(`pb.project_id = $${n}`);
      params.push(pid);
      n += 1;
    }
    if (term) {
      const t = `%${term}%`;
      where.push(`(pb.block_code ilike $${n} or pb.block_name ilike $${n + 1} or p.project_name ilike $${n + 2})`);
      params.push(t, t, t);
      n += 3;
    }
    const result = await this.db.query<{
      value: string;
      label: string;
      block_code: string;
      project_id: string;
      project_name: string;
    }>(
      `
      select
        pb.id as value,
        pb.block_name || ' (' || pb.block_code || ')' as label,
        pb.block_code,
        pb.project_id,
        p.project_name
      from project_block pb
      join project p on p.id = pb.project_id
      where ${where.join(' and ')}
      order by pb.block_name asc
      `,
      params
    );
    return result.rows;
  }

  async getById(id: string) {
    const result = await this.db.query<ProjectBlockRow>(
      `
      select
        pb.id,
        pb.block_code,
        pb.project_id,
        p.project_name,
        pb.block_name,
        pb.center_latitude::text as center_latitude,
        pb.center_longitude::text as center_longitude,
        pb.area_size::text as area_size,
        pb.priority,
        pb.status,
        coalesce(pb.remarks, '') as remarks
      from project_block pb
      join project p on p.id = pb.project_id and p.tenant_id = pb.tenant_id
      where pb.tenant_id = $1 and pb.id = $2
      `,
      [TENANT_ID, id]
    );
    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.NOT_FOUND, 'TARGET_NOT_FOUND', 'Project block not found', { id });
    }
    return toProjectBlockCompat(row);
  }

  async create(dto: CreateProjectBlockDto) {
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'block_code')) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'block_code', message: 'block_code must not be provided' }]
      });
    }
    if (!dto.block_name?.trim()) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'block_name', message: 'block_name is required' }]
      });
    }
    if (!dto.project_id?.trim()) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'project_id', message: 'project_id is required' }]
      });
    }

    const resolvedArea = resolveAreaSizeForWrite(dto);
    const id = await this.db.withTransaction(async (client) => {
      await this.ensureProjectExists(dto.project_id!.trim(), client);
      const code = await this.generateBlockCode(client);
      const inserted = await this.db.query<{ id: string }>(
        `
        insert into project_block (
          tenant_id, block_code, project_id, block_name,
          center_latitude, center_longitude, area_size, priority, status, remarks
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning id
        `,
        [
          TENANT_ID,
          code,
          dto.project_id!.trim(),
          dto.block_name!.trim(),
          dto.center_latitude ?? null,
          dto.center_longitude ?? null,
          resolvedArea !== undefined ? resolvedArea : null,
          dto.priority ?? 0,
          dto.status ?? 'draft',
          dto.remarks?.trim() ?? ''
        ],
        client
      );
      return inserted.rows[0].id;
    });

    return this.getById(id);
  }

  async update(id: string, dto: UpdateProjectBlockDto) {
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'block_code')) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'block_code', message: 'block_code cannot be updated' }]
      });
    }

    const existing = await this.getById(id);

    const areaPatch = resolveAreaSizeForWrite(dto);
    const nextAreaSize =
      areaPatch !== undefined ? areaPatch : existing.area_size != null ? Number(existing.area_size) : null;

    await this.db.withTransaction(async (client) => {
      const nextProjectId = dto.project_id?.trim() ?? existing.project_id;
      if (dto.project_id?.trim()) {
        await this.ensureProjectExists(nextProjectId, client);
      }

      await this.db.query(
        `
        update project_block
        set
          project_id = $3,
          block_name = $4,
          center_latitude = $5,
          center_longitude = $6,
          area_size = $7,
          priority = $8,
          status = $9,
          remarks = $10,
          updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          nextProjectId,
          dto.block_name?.trim() ?? existing.block_name,
          dto.center_latitude !== undefined ? dto.center_latitude : existing.center_latitude,
          dto.center_longitude !== undefined ? dto.center_longitude : existing.center_longitude,
          nextAreaSize,
          dto.priority !== undefined ? dto.priority : existing.priority,
          dto.status ?? existing.status,
          dto.remarks !== undefined ? dto.remarks?.trim() ?? '' : existing.remarks
        ],
        client
      );
    });

    return this.getById(id);
  }

  async delete(id: string) {
    await this.getById(id);

    const linkedMeteringPoints = await this.db.query<{ count: string }>(
      `
      select count(*)::text as count
      from metering_point
      where tenant_id = $1 and block_id = $2
      `,
      [TENANT_ID, id]
    );

    if (Number(linkedMeteringPoints.rows[0]?.count ?? 0) > 0) {
      throw appException(HttpStatus.CONFLICT, 'DELETE_BLOCKED', 'Project block cannot be deleted while metering points still reference it', {
        id,
        reason: 'HAS_METERING_POINTS'
      });
    }

    await this.db.query(
      `
      delete from project_block
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, id]
    );
  }
}

@Controller('project-blocks')
class ProjectBlockController {
  constructor(private readonly service: ProjectBlockService) {}

  @Get()
  list(@Query('page') page?: string, @Query('page_size') pageSize?: string, @Query('q') q?: string) {
    return this.service.list(parsePage(page), parsePageSize(pageSize), q);
  }

  @Get('options')
  options(@Query('project_id') projectId?: string, @Query('q') q?: string) {
    return this.service.options(projectId, q);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  create(@Body() dto: CreateProjectBlockDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectBlockDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
  }
}

@Module({
  controllers: [ProjectBlockController],
  providers: [ProjectBlockService]
})
export class ProjectBlockModule {}
