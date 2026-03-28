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
  Param,
  Post,
  Put,
  Query
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PROJECT_STATUSES = ['draft', 'active', 'archived'] as const;
const PROJECT_CODE_PREFIX = 'PRJ-HJ-';

type ProjectStatus = (typeof PROJECT_STATUSES)[number];

interface ProjectRecord {
  id: string;
  project_code: string;
  project_name: string;
  region_id: string;
  region_name: string;
  region_full_path_name?: string;
  manual_region_id: string | null;
  manual_region_name: string | null;
  manual_region_full_path_name: string | null;
  maintenance_team_id: string | null;
  maintenance_team_name: string | null;
  status: ProjectStatus;
  owner: string;
  contact_phone: string;
  operator: string;
  remarks: string;
}

interface ProjectOption {
  value: string;
  label: string;
  project_code: string;
  region_id: string;
  region_name: string;
  region_full_path_name?: string;
  manual_region_id: string | null;
  manual_region_name: string | null;
  manual_region_full_path_name: string | null;
  status: string;
}

interface CreateProjectDto {
  project_name?: string;
  region_id?: string;
  manual_region_id?: string | null;
  maintenance_team_id?: string | null;
  status?: ProjectStatus;
  owner?: string;
  contact_phone?: string;
  operator?: string;
  remarks?: string;
}

interface UpdateProjectDto {
  project_code?: string;
  region_id?: string;
  manual_region_id?: string | null;
  maintenance_team_id?: string | null;
  project_name?: string;
  status?: ProjectStatus;
  owner?: string;
  contact_phone?: string;
  operator?: string;
  remarks?: string;
}

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException(
    {
      requestId: 'local-dev',
      code,
      message,
      data
    },
    status
  );
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

function validateContactPhone(value: string) {
  return /^[0-9+\-()\s]{6,32}$/.test(value);
}

@Injectable()
class ProjectService {
  constructor(private readonly db: DatabaseService) {}

  private async generateProjectCode(client: PoolClient) {
    await this.db.query(
      `
      select setval(
        'project_code_seq',
        greatest(
          coalesce(
            (
              select max(substring(project_code from '([0-9]+)$')::int)
              from project
              where tenant_id = $1
                and project_code like $2
            ),
            0
          ),
          (
            select last_value
            from project_code_seq
          )
        ),
        true
      )
      `,
      [TENANT_ID, `${PROJECT_CODE_PREFIX}%`],
      client
    );

    const result = await this.db.query<{ next_code: string }>(
      `
      select $1 || lpad(nextval('project_code_seq')::text, 3, '0') as next_code
      `,
      [PROJECT_CODE_PREFIX],
      client
    );
    return result.rows[0].next_code;
  }

  private async ensureBusinessRegionExists(regionId: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from region
      where tenant_id = $1 and id = $2 and status = 'active'
      `,
      [TENANT_ID, regionId],
      client
    );

    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          region_id: 'region_id is invalid'
        }
      });
    }
  }

  private async ensureManualRegionCodeExists(regionCode: string, client?: PoolClient) {
    const result = await this.db.query<{ code: string }>(
      `
      select code
      from region_reference
      where code = $1 and enabled = true
      `,
      [regionCode],
      client
    );

    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          manual_region_id: 'manual_region_id is invalid'
        }
      });
    }
  }

  private async ensureActiveMaintenanceTeamExists(maintenanceTeamId: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from maintenance_team
      where tenant_id = $1 and id = $2 and status = 'active'
      `,
      [TENANT_ID, maintenanceTeamId],
      client
    );

    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          maintenance_team_id: 'maintenance_team_id is invalid'
        }
      });
    }
  }

  async list(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<ProjectRecord & { total_count: string }>(
      `
      select
        p.id,
        p.project_code,
        p.project_name,
        p.region_id,
        coalesce(rr.full_path_name, r.region_name) as region_name,
        rr.full_path_name as region_full_path_name,
        p.manual_region_id,
        mrr.name as manual_region_name,
        mrr.full_path_name as manual_region_full_path_name,
        p.maintenance_team_id,
        mt.team_name as maintenance_team_name,
        p.status,
        p.owner,
        p.contact_phone,
        p.operator,
        coalesce(p.remarks, '') as remarks,
        count(*) over()::text as total_count
      from project p
      join region r on r.id = p.region_id
      left join region_reference rr on rr.code = r.region_code
      left join region_reference mrr on mrr.code = p.manual_region_id
      left join maintenance_team mt on mt.id = p.maintenance_team_id
      where p.tenant_id = $1
      order by p.created_at asc
      limit $2 offset $3
      `,
      [TENANT_ID, pageSize, offset]
    );

    const items = result.rows.map(({ total_count, ...row }) => row);
    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
    return {
      items,
      total,
      page,
      page_size: pageSize
    };
  }

  async options(): Promise<ProjectOption[]> {
    const result = await this.db.query<ProjectOption>(
      `
      select
        p.id as value,
        p.project_name as label,
        p.project_code,
        p.region_id,
        coalesce(rr.full_path_name, r.region_name) as region_name,
        rr.full_path_name as region_full_path_name,
        p.manual_region_id,
        mrr.name as manual_region_name,
        mrr.full_path_name as manual_region_full_path_name,
        p.maintenance_team_id,
        mt.team_name as maintenance_team_name,
        p.status
      from project p
      join region r on r.id = p.region_id
      left join region_reference rr on rr.code = r.region_code
      left join region_reference mrr on mrr.code = p.manual_region_id
      left join maintenance_team mt on mt.id = p.maintenance_team_id
      where p.tenant_id = $1
      order by p.created_at asc
      `,
      [TENANT_ID]
    );
    return result.rows;
  }

  async getById(id: string) {
    const result = await this.db.query<ProjectRecord>(
      `
      select
        p.id,
        p.project_code,
        p.project_name,
        p.region_id,
        coalesce(rr.full_path_name, r.region_name) as region_name,
        rr.full_path_name as region_full_path_name,
        p.manual_region_id,
        mrr.name as manual_region_name,
        mrr.full_path_name as manual_region_full_path_name,
        p.maintenance_team_id,
        mt.team_name as maintenance_team_name,
        p.status,
        p.owner,
        p.contact_phone,
        p.operator,
        coalesce(p.remarks, '') as remarks
      from project p
      join region r on r.id = p.region_id
      left join region_reference rr on rr.code = r.region_code
      left join region_reference mrr on mrr.code = p.manual_region_id
      left join maintenance_team mt on mt.id = p.maintenance_team_id
      where p.tenant_id = $1 and p.id = $2
      `,
      [TENANT_ID, id]
    );

    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.NOT_FOUND, 'TARGET_NOT_FOUND', 'Project not found', { id });
    }
    return row;
  }

  async create(dto: CreateProjectDto) {
    const errors: Array<{ field: string; message: string }> = [];
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'project_code')) {
      errors.push({ field: 'project_code', message: 'project_code must not be provided' });
    }
    if (!dto.project_name?.trim()) errors.push({ field: 'project_name', message: 'project_name is required' });
    if (!dto.region_id?.trim()) errors.push({ field: 'region_id', message: 'region_id is required' });
    if (!dto.owner?.trim()) errors.push({ field: 'owner', message: 'owner is required' });
    if (!dto.contact_phone?.trim()) errors.push({ field: 'contact_phone', message: 'contact_phone is required' });
    if (!dto.operator?.trim()) errors.push({ field: 'operator', message: 'operator is required' });
    if (dto.contact_phone?.trim() && !validateContactPhone(dto.contact_phone.trim())) {
      errors.push({ field: 'contact_phone', message: 'contact_phone is invalid' });
    }
    if (dto.status && !PROJECT_STATUSES.includes(dto.status)) errors.push({ field: 'status', message: 'status is invalid' });
    if (errors.length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { errors });
    }

    const created = await this.db.withTransaction(async (client) => {
      const resolvedRegionId = dto.region_id!.trim();
      const resolvedManualRegionId = dto.manual_region_id?.trim() || null;
      const generatedProjectCode = await this.generateProjectCode(client);
      await this.ensureBusinessRegionExists(resolvedRegionId, client);
      if (resolvedManualRegionId) {
        await this.ensureManualRegionCodeExists(resolvedManualRegionId, client);
      }
      if (dto.maintenance_team_id?.trim()) {
        await this.ensureActiveMaintenanceTeamExists(dto.maintenance_team_id.trim(), client);
      }

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into project (
          tenant_id,
          project_code,
          project_name,
          region_id,
          manual_region_id,
          maintenance_team_id,
          status,
          owner,
          contact_phone,
          operator,
          remarks
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning id
        `,
        [
          TENANT_ID,
          generatedProjectCode,
          dto.project_name!.trim(),
          resolvedRegionId,
          resolvedManualRegionId,
          dto.maintenance_team_id?.trim() || null,
          dto.status ?? 'draft',
          dto.owner!.trim(),
          dto.contact_phone!.trim(),
          dto.operator!.trim(),
          dto.remarks?.trim() ?? ''
        ],
        client
      );
      return inserted.rows[0].id;
    });

    return this.getById(created);
  }

  async update(id: string, dto: UpdateProjectDto) {
    if (isPlainObject(dto) && Object.prototype.hasOwnProperty.call(dto, 'project_code')) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'project_code', message: 'project_code cannot be updated' }]
      });
    }
    if (dto.status && !PROJECT_STATUSES.includes(dto.status)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'status', message: 'status is invalid' }]
      });
    }
    if (dto.contact_phone?.trim() && !validateContactPhone(dto.contact_phone.trim())) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        errors: [{ field: 'contact_phone', message: 'contact_phone is invalid' }]
      });
    }

    const existing = await this.getById(id);
    const next = {
      region_id: dto.region_id?.trim() ?? existing.region_id,
      manual_region_id: dto.manual_region_id === undefined ? existing.manual_region_id : dto.manual_region_id?.trim() || null,
      maintenance_team_id: dto.maintenance_team_id === undefined ? existing.maintenance_team_id : dto.maintenance_team_id?.trim() || null,
      project_name: dto.project_name?.trim() ?? existing.project_name,
      status: dto.status ?? existing.status,
      owner: dto.owner?.trim() ?? existing.owner,
      contact_phone: dto.contact_phone?.trim() ?? existing.contact_phone,
      operator: dto.operator?.trim() ?? existing.operator,
      remarks: dto.remarks?.trim() ?? existing.remarks
    };

    await this.db.withTransaction(async (client) => {
      const resolvedRegionId = next.region_id;
      await this.ensureBusinessRegionExists(resolvedRegionId, client);
      if (next.manual_region_id) {
        await this.ensureManualRegionCodeExists(next.manual_region_id, client);
      }
      if (next.maintenance_team_id) {
        await this.ensureActiveMaintenanceTeamExists(next.maintenance_team_id, client);
      }

      await this.db.query(
        `
        update project
        set
          project_name = $3,
          region_id = $4,
          manual_region_id = $5,
          maintenance_team_id = $6,
          status = $7,
          owner = $8,
          contact_phone = $9,
          operator = $10,
          remarks = $11,
          updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [TENANT_ID, id, next.project_name, resolvedRegionId, next.manual_region_id, next.maintenance_team_id, next.status, next.owner, next.contact_phone, next.operator, next.remarks],
        client
      );
    });

    return this.getById(id);
  }

  async delete(id: string) {
    await this.getById(id);

    const linkedAssets = await this.db.query<{ count: string }>(
      `
      select count(*)::text as count
      from asset
      where tenant_id = $1 and project_id = $2
      `,
      [TENANT_ID, id]
    );

    if (Number(linkedAssets.rows[0]?.count ?? 0) > 0) {
      throw appException(HttpStatus.CONFLICT, 'DELETE_BLOCKED', 'Project cannot be deleted while assets still exist', {
        id,
        reason: 'HAS_ASSETS'
      });
    }

    await this.db.query(
      `
      delete from project
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, id]
    );
  }
}

@Controller('projects')
class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get()
  list(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return this.service.list(parsePage(page), parsePageSize(pageSize));
  }

  @Get('options')
  options() {
    return this.service.options();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
  }
}

@Module({
  controllers: [ProjectController],
  providers: [ProjectService]
})
export class ProjectModule {}
