import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEVICE_CATEGORY_OPTIONS = [
  { value: 'controller', label: 'Controller' },
  { value: 'actuator', label: 'Actuator' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'gateway', label: 'Gateway' },
  { value: 'camera', label: 'Camera' },
  { value: 'collector', label: 'Collector' }
] as const;
const COMM_IDENTITY_OPTIONS = [
  { value: 'imei', label: 'IMEI' },
  { value: 'chip_sn', label: 'Chip SN' }
] as const;

interface DeviceTypePayload {
  device_type_code?: string;
  device_type_name?: string;
  device_category?: string;
  preferred_comm_identity_type?: string;
  supports_control?: boolean;
  supports_telemetry?: boolean;
  supports_location_report?: boolean;
  enabled?: boolean;
  remarks?: string | null;
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

function normalizeCategory(family: string) {
  switch (family) {
    case 'well':
    case 'pump':
      return 'controller';
    case 'valve':
      return 'actuator';
    case 'sensor':
      return 'sensor';
    default:
      return family;
  }
}

function buildTypeCode(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `device_type_${Date.now()}`;
}

@Injectable()
class DeviceTypeService {
  constructor(private readonly db: DatabaseService) {}

  private mapRow(row: Record<string, any>) {
    return {
      id: row.id,
      device_type_code: row.type_code,
      device_type_name: row.type_name,
      device_category: normalizeCategory(row.family),
      preferred_comm_identity_type: row.preferred_comm_identity_type ?? 'imei',
      supports_control: Boolean(row.supports_control),
      supports_telemetry: Boolean(row.supports_telemetry),
      supports_location_report: Boolean(row.supports_location_report),
      enabled: row.status === 'active',
      remarks: row.remarks ?? null
    };
  }

  private async getRow(id: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        dt.id,
        dt.type_code,
        dt.type_name,
        dt.family,
        coalesce(dt.default_config_json->>'preferred_comm_identity_type', 'imei') as preferred_comm_identity_type,
        coalesce((dt.capability_json->>'supports_control')::boolean, dt.family in ('well', 'pump', 'valve', 'controller', 'actuator')) as supports_control,
        coalesce((dt.capability_json->>'supports_telemetry')::boolean, jsonb_array_length(coalesce(dt.capability_json->'metrics', '[]'::jsonb)) > 0) as supports_telemetry,
        coalesce((dt.capability_json->>'supports_location_report')::boolean, false) as supports_location_report,
        dt.status,
        coalesce(dt.capability_json->>'remarks', '') as remarks
      from device_type dt
      where dt.tenant_id = $1 and dt.id = $2
      `,
      [TENANT_ID, id],
      client
    );
    return result.rows[0] ?? null;
  }

  private async ensureUniqueTypeCode(typeCode: string, ignoreId?: string, client?: PoolClient) {
    const params: unknown[] = [TENANT_ID, typeCode];
    const clauses = ['tenant_id = $1', 'type_code = $2'];
    if (ignoreId) {
      params.push(ignoreId);
      clauses.push(`id <> $${params.length}`);
    }
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from device_type
      where ${clauses.join(' and ')}
      limit 1
      `,
      params,
      client
    );
    if (result.rows[0]) {
      throw appException(HttpStatus.CONFLICT, 'DUPLICATE_TYPE_CODE', 'Device type code already exists', {
        fieldErrors: { device_type_code: ['device_type_code already exists'] }
      });
    }
  }

  private validatePayload(dto: DeviceTypePayload, isCreate: boolean) {
    const fieldErrors: Record<string, string[]> = {};
    if (isCreate && !dto.device_type_name?.trim()) {
      fieldErrors.device_type_name = ['device_type_name is required'];
    }
    if (isCreate && !dto.device_category?.trim()) {
      fieldErrors.device_category = ['device_category is required'];
    }
    if (isCreate && !dto.preferred_comm_identity_type?.trim()) {
      fieldErrors.preferred_comm_identity_type = ['preferred_comm_identity_type is required'];
    }
    if (dto.device_category && !DEVICE_CATEGORY_OPTIONS.some((item) => item.value === dto.device_category)) {
      fieldErrors.device_category = ['device_category is invalid'];
    }
    if (
      dto.preferred_comm_identity_type &&
      !COMM_IDENTITY_OPTIONS.some((item) => item.value === dto.preferred_comm_identity_type)
    ) {
      fieldErrors.preferred_comm_identity_type = ['preferred_comm_identity_type is invalid'];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }
  }

  async list(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<Record<string, any>>(
      `
      select
        dt.id,
        dt.type_code,
        dt.type_name,
        dt.family,
        coalesce(dt.default_config_json->>'preferred_comm_identity_type', 'imei') as preferred_comm_identity_type,
        coalesce((dt.capability_json->>'supports_control')::boolean, dt.family in ('well', 'pump', 'valve', 'controller', 'actuator')) as supports_control,
        coalesce((dt.capability_json->>'supports_telemetry')::boolean, jsonb_array_length(coalesce(dt.capability_json->'metrics', '[]'::jsonb)) > 0) as supports_telemetry,
        coalesce((dt.capability_json->>'supports_location_report')::boolean, false) as supports_location_report,
        dt.status,
        coalesce(dt.capability_json->>'remarks', '') as remarks,
        count(*) over()::int as total_count
      from device_type dt
      where dt.tenant_id = $1
      order by dt.created_at asc
      limit $2 offset $3
      `,
      [TENANT_ID, pageSize, offset]
    );
    return {
      items: result.rows.map((row) => this.mapRow(row)),
      total: result.rows[0]?.total_count ?? 0,
      page,
      page_size: pageSize
    };
  }

  async detail(id: string) {
    const row = await this.getRow(id);
    if (!row) {
      throw new NotFoundException('device_type not found');
    }
    return this.mapRow(row);
  }

  async create(dto: DeviceTypePayload) {
    this.validatePayload(dto, true);
    const createdId = await this.db.withTransaction(async (client) => {
      const typeName = dto.device_type_name!.trim();
      const typeCode = dto.device_type_code?.trim() || buildTypeCode(typeName);
      await this.ensureUniqueTypeCode(typeCode, undefined, client);
      const inserted = await this.db.query<{ id: string }>(
        `
        insert into device_type (
          tenant_id,
          type_code,
          type_name,
          family,
          capability_json,
          default_config_json,
          form_schema_json,
          status
        ) values ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7)
        returning id
        `,
        [
          TENANT_ID,
          typeCode,
          typeName,
          dto.device_category,
          JSON.stringify({
            supports_control: dto.supports_control ?? false,
            supports_telemetry: dto.supports_telemetry ?? false,
            supports_location_report: dto.supports_location_report ?? false,
            remarks: dto.remarks ?? ''
          }),
          JSON.stringify({
            preferred_comm_identity_type: dto.preferred_comm_identity_type
          }),
          dto.enabled === false ? 'draft' : 'active'
        ],
        client
      );
      return inserted.rows[0].id;
    });
    return this.detail(createdId);
  }

  async update(id: string, dto: DeviceTypePayload) {
    this.validatePayload(dto, false);
    const existing = await this.getRow(id);
    if (!existing) {
      throw new NotFoundException('device_type not found');
    }

    await this.db.withTransaction(async (client) => {
      const typeName = dto.device_type_name?.trim() || existing.type_name;
      const typeCode = dto.device_type_code?.trim() || existing.type_code;
      await this.ensureUniqueTypeCode(typeCode, id, client);
      await this.db.query(
        `
        update device_type
        set type_code = $3,
            type_name = $4,
            family = $5,
            capability_json = $6,
            default_config_json = $7,
            status = $8,
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          typeCode,
          typeName,
          dto.device_category ?? existing.family,
          JSON.stringify({
            supports_control: dto.supports_control ?? existing.supports_control,
            supports_telemetry: dto.supports_telemetry ?? existing.supports_telemetry,
            supports_location_report: dto.supports_location_report ?? existing.supports_location_report,
            remarks: dto.remarks === undefined ? existing.remarks ?? '' : dto.remarks ?? ''
          }),
          JSON.stringify({
            preferred_comm_identity_type:
              dto.preferred_comm_identity_type ?? existing.preferred_comm_identity_type ?? 'imei'
          }),
          dto.enabled === undefined ? existing.status : dto.enabled ? 'active' : 'draft'
        ],
        client
      );
    });

    return this.detail(id);
  }

  async remove(id: string) {
    const row = await this.getRow(id);
    if (!row) {
      throw new NotFoundException('device_type not found');
    }
    const linked = await this.db.query<{ count: string }>(
      `
      select count(*)::text as count
      from device
      where tenant_id = $1 and device_type_id = $2
      `,
      [TENANT_ID, id]
    );
    if (Number(linked.rows[0]?.count ?? 0) > 0) {
      throw appException(HttpStatus.CONFLICT, 'DELETE_BLOCKED', 'Delete blocked', {
        id,
        reason: 'device type is referenced by existing devices'
      });
    }
    await this.db.query(
      `
      delete from device_type
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, id]
    );
  }
}

@Controller('device-types')
class DeviceTypeController {
  constructor(private readonly service: DeviceTypeService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return ok(await this.service.list(parsePage(page), parsePageSize(pageSize)));
  }

  @Get('options')
  async options() {
    const result = await this.service.list(1, 200);
    return result.items.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.device_type_name }));
  }

  @Get('category-options')
  categoryOptions() {
    return DEVICE_CATEGORY_OPTIONS;
  }

  @Get('comm-identity-type-options')
  commIdentityTypeOptions() {
    return COMM_IDENTITY_OPTIONS;
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.service.detail(id));
  }

  @Post()
  async create(@Body() dto: DeviceTypePayload) {
    return ok(await this.service.create(dto));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: DeviceTypePayload) {
    return ok(await this.service.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}

@Module({
  controllers: [DeviceTypeController],
  providers: [DeviceTypeService]
})
export class DeviceTypeModule {}
