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
import { DatabaseService } from '../../common/db/database.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TEAM_STATUSES = ['active', 'inactive'] as const;

type TeamStatus = (typeof TEAM_STATUSES)[number];

interface MaintenanceTeamRecord {
  id: string;
  team_name: string;
  leader_name: string;
  contact_phone: string;
  status: TeamStatus;
  remarks: string;
}

interface MaintenanceTeamOption {
  value: string;
  label: string;
}

interface CreateMaintenanceTeamDto {
  team_name?: string;
  leader_name?: string;
  contact_phone?: string;
  status?: TeamStatus;
  remarks?: string;
}

interface UpdateMaintenanceTeamDto {
  team_name?: string;
  leader_name?: string;
  contact_phone?: string;
  status?: TeamStatus;
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

function validateContactPhone(value: string) {
  return /^[0-9+\-()\s]{6,32}$/.test(value);
}

@Injectable()
class MaintenanceTeamService {
  constructor(private readonly db: DatabaseService) {}

  private async ensureUniqueName(teamName: string, excludeId?: string, client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from maintenance_team
      where tenant_id = $1
        and team_name = $2
        and ($3::uuid is null or id <> $3::uuid)
      `,
      [TENANT_ID, teamName, excludeId ?? null],
      client
    );

    if (result.rows[0]) {
      throw appException(HttpStatus.CONFLICT, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          team_name: 'team_name already exists'
        }
      });
    }
  }

  async list(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<MaintenanceTeamRecord & { total_count: string }>(
      `
      select
        mt.id,
        mt.team_name,
        mt.leader_name,
        mt.contact_phone,
        mt.status,
        coalesce(mt.remarks, '') as remarks,
        count(*) over()::text as total_count
      from maintenance_team mt
      where mt.tenant_id = $1
      order by mt.created_at asc
      limit $2 offset $3
      `,
      [TENANT_ID, pageSize, offset]
    );

    return {
      items: result.rows.map(({ total_count, ...row }) => row),
      total: result.rows.length > 0 ? Number(result.rows[0].total_count) : 0,
      page,
      page_size: pageSize
    };
  }

  async options(): Promise<MaintenanceTeamOption[]> {
    const result = await this.db.query<MaintenanceTeamOption>(
      `
      select
        id as value,
        team_name as label
      from maintenance_team
      where tenant_id = $1 and status = 'active'
      order by created_at asc
      `,
      [TENANT_ID]
    );
    return result.rows;
  }

  async getById(id: string) {
    const result = await this.db.query<MaintenanceTeamRecord>(
      `
      select
        mt.id,
        mt.team_name,
        mt.leader_name,
        mt.contact_phone,
        mt.status,
        coalesce(mt.remarks, '') as remarks
      from maintenance_team mt
      where mt.tenant_id = $1 and mt.id = $2
      `,
      [TENANT_ID, id]
    );

    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.NOT_FOUND, 'TARGET_NOT_FOUND', 'Maintenance team not found', { id });
    }
    return row;
  }

  async create(dto: CreateMaintenanceTeamDto) {
    const fieldErrors: Record<string, string> = {};
    if (!dto.team_name?.trim()) fieldErrors.team_name = 'team_name is required';
    if (!dto.leader_name?.trim()) fieldErrors.leader_name = 'leader_name is required';
    if (!dto.contact_phone?.trim()) fieldErrors.contact_phone = 'contact_phone is required';
    if (dto.contact_phone?.trim() && !validateContactPhone(dto.contact_phone.trim())) {
      fieldErrors.contact_phone = 'contact_phone is invalid';
    }
    if (dto.status && !TEAM_STATUSES.includes(dto.status)) fieldErrors.status = 'status is invalid';
    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }

    const id = await this.db.withTransaction(async (client) => {
      await this.ensureUniqueName(dto.team_name!.trim(), undefined, client);
      const inserted = await this.db.query<{ id: string }>(
        `
        insert into maintenance_team (
          tenant_id,
          team_name,
          leader_name,
          contact_phone,
          status,
          remarks
        ) values ($1, $2, $3, $4, $5, $6)
        returning id
        `,
        [
          TENANT_ID,
          dto.team_name!.trim(),
          dto.leader_name!.trim(),
          dto.contact_phone!.trim(),
          dto.status ?? 'active',
          dto.remarks?.trim() ?? ''
        ],
        client
      );
      return inserted.rows[0].id;
    });

    return this.getById(id);
  }

  async update(id: string, dto: UpdateMaintenanceTeamDto) {
    if (dto.status && !TEAM_STATUSES.includes(dto.status)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { status: 'status is invalid' }
      });
    }
    if (dto.contact_phone?.trim() && !validateContactPhone(dto.contact_phone.trim())) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { contact_phone: 'contact_phone is invalid' }
      });
    }

    const existing = await this.getById(id);
    const next = {
      team_name: dto.team_name?.trim() ?? existing.team_name,
      leader_name: dto.leader_name?.trim() ?? existing.leader_name,
      contact_phone: dto.contact_phone?.trim() ?? existing.contact_phone,
      status: dto.status ?? existing.status,
      remarks: dto.remarks?.trim() ?? existing.remarks
    };

    await this.db.withTransaction(async (client) => {
      await this.ensureUniqueName(next.team_name, id, client);
      await this.db.query(
        `
        update maintenance_team
        set
          team_name = $3,
          leader_name = $4,
          contact_phone = $5,
          status = $6,
          remarks = $7,
          updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [TENANT_ID, id, next.team_name, next.leader_name, next.contact_phone, next.status, next.remarks],
        client
      );
    });

    return this.getById(id);
  }
}

@Controller('maintenance-teams')
class MaintenanceTeamController {
  constructor(private readonly service: MaintenanceTeamService) {}

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
  create(@Body() dto: CreateMaintenanceTeamDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMaintenanceTeamDto) {
    return this.service.update(id, dto);
  }
}

@Module({
  controllers: [MaintenanceTeamController],
  providers: [MaintenanceTeamService]
})
export class MaintenanceTeamModule {}
