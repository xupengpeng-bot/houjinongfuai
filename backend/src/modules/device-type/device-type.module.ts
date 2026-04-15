import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';
import { STANDARD_DEVICE_TYPE_TEMPLATES, type StandardDeviceTypeTemplate } from './device-type-standard-catalog';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEVICE_CATEGORY_OPTIONS = [
  { value: 'controller', label: '控制器' },
  { value: 'actuator', label: '执行器' },
  { value: 'sensor', label: '传感器' },
  { value: 'gateway', label: '网关' },
  { value: 'camera', label: '摄像头' },
  { value: 'collector', label: '采集器' }
] as const;
const COMM_IDENTITY_OPTIONS = [
  { value: 'imei', label: 'IMEI' },
  { value: 'chip_sn', label: '芯片序列号' }
] as const;

interface DeviceTypePayload {
  device_type_code?: string;
  device_type_name?: string;
  device_category?: string;
  preferred_comm_identity_type?: string;
  supports_control?: boolean;
  supports_telemetry?: boolean;
  supports_location_report?: boolean;
  capability_json?: Record<string, unknown> | null;
  default_config_json?: Record<string, unknown> | null;
  form_schema_json?: Record<string, unknown> | null;
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
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized.length >= 4) {
    return normalized;
  }
  const timestamp = Date.now().toString(36);
  const seed = Math.random().toString(36).slice(2, 6);
  return `device_type_${timestamp}_${seed}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeDefaults(base: Record<string, unknown>, override: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMergeDefaults(result[key] as Record<string, unknown>, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function mergeCapabilityJson(base: Record<string, unknown>, dto: DeviceTypePayload) {
  const next: Record<string, unknown> = {
    ...base,
    ...(isPlainObject(dto.capability_json) ? dto.capability_json : {}),
  };
  if (dto.supports_control !== undefined) next.supports_control = dto.supports_control;
  if (dto.supports_telemetry !== undefined) next.supports_telemetry = dto.supports_telemetry;
  if (dto.supports_location_report !== undefined) next.supports_location_report = dto.supports_location_report;
  if (dto.remarks !== undefined) next.remarks = dto.remarks ?? '';
  return next;
}

function mergeDefaultConfigJson(base: Record<string, unknown>, dto: DeviceTypePayload) {
  const next: Record<string, unknown> = {
    ...base,
    ...(isPlainObject(dto.default_config_json) ? dto.default_config_json : {}),
  };
  if (dto.preferred_comm_identity_type !== undefined) {
    next.preferred_comm_identity_type = dto.preferred_comm_identity_type;
  }
  return next;
}

function mergeFormSchemaJson(base: Record<string, unknown>, dto: DeviceTypePayload) {
  return {
    ...base,
    ...(isPlainObject(dto.form_schema_json) ? dto.form_schema_json : {}),
  };
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
      capability_json: row.capability_json ?? {},
      default_config_json: row.default_config_json ?? {},
      form_schema_json: row.form_schema_json ?? {},
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
        dt.capability_json,
        dt.default_config_json,
        dt.form_schema_json,
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

  private async getRowByTypeCode(typeCode: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        dt.id,
        dt.type_code,
        dt.type_name,
        dt.family,
        dt.capability_json,
        dt.default_config_json,
        dt.form_schema_json,
        coalesce(dt.default_config_json->>'preferred_comm_identity_type', 'imei') as preferred_comm_identity_type,
        coalesce((dt.capability_json->>'supports_control')::boolean, dt.family in ('well', 'pump', 'valve', 'controller', 'actuator')) as supports_control,
        coalesce((dt.capability_json->>'supports_telemetry')::boolean, jsonb_array_length(coalesce(dt.capability_json->'metrics', '[]'::jsonb)) > 0) as supports_telemetry,
        coalesce((dt.capability_json->>'supports_location_report')::boolean, false) as supports_location_report,
        dt.status,
        coalesce(dt.capability_json->>'remarks', '') as remarks
      from device_type dt
      where dt.tenant_id = $1 and dt.type_code = $2
      limit 1
      `,
      [TENANT_ID, typeCode],
      client
    );
    return result.rows[0] ?? null;
  }

  private buildStandardCatalogItem(template: StandardDeviceTypeTemplate, existing?: Record<string, any> | null) {
    const versioning = isPlainObject(template.default_config_json.versioning)
      ? template.default_config_json.versioning
      : {};
    return {
      type_code: template.type_code,
      type_name: template.type_name,
      device_category: template.device_category,
      preferred_comm_identity_type: template.preferred_comm_identity_type,
      supports_control: template.supports_control,
      supports_telemetry: template.supports_telemetry,
      supports_location_report: template.supports_location_report,
      initialized: Boolean(existing),
      existing_device_type_id: existing?.id ?? null,
      policy_code: String(versioning.policy_code ?? '') || null,
      bundle_code_seed: String(versioning.bundle_code_seed ?? '') || null,
      software_families: Array.isArray(versioning.software_catalog)
        ? versioning.software_catalog.map((item) => String((item as Record<string, unknown>).family ?? '')).filter(Boolean)
        : [],
      embedded_families: Array.isArray(versioning.embedded_catalog)
        ? versioning.embedded_catalog.map((item) => String((item as Record<string, unknown>).family ?? '')).filter(Boolean)
        : [],
      hardware_models: Array.isArray(versioning.hardware_catalog)
        ? versioning.hardware_catalog.map((item) => ({
            sku: String((item as Record<string, unknown>).sku ?? '') || null,
            revisions: Array.isArray((item as Record<string, unknown>).revisions)
              ? ((item as Record<string, unknown>).revisions as unknown[]).map((rev) => String(rev ?? '')).filter(Boolean)
              : [],
            name: String((item as Record<string, unknown>).name ?? '') || null,
          }))
        : [],
      remarks: template.remarks,
    };
  }

  async ensureStandardCatalog() {
    return this.db.withTransaction(async (client) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const template of STANDARD_DEVICE_TYPE_TEMPLATES) {
        const existing = await this.getRowByTypeCode(template.type_code, client);
        if (!existing) {
          const capabilityJson = mergeCapabilityJson(template.capability_json, {
            supports_control: template.supports_control,
            supports_telemetry: template.supports_telemetry,
            supports_location_report: template.supports_location_report,
            remarks: template.remarks,
          });
          const defaultConfigJson = mergeDefaultConfigJson(template.default_config_json, {
            preferred_comm_identity_type: template.preferred_comm_identity_type,
          });
          await this.db.query(
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
            ) values ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [
              TENANT_ID,
              template.type_code,
              template.type_name,
              template.device_category,
              JSON.stringify(capabilityJson),
              JSON.stringify(defaultConfigJson),
              JSON.stringify(template.form_schema_json),
              template.enabled ? 'active' : 'draft',
            ],
            client
          );
          created += 1;
          continue;
        }

        const nextCapability = deepMergeDefaults(
          template.capability_json,
          isPlainObject(existing.capability_json) ? existing.capability_json : {},
        );
        const nextDefaultConfig = deepMergeDefaults(
          template.default_config_json,
          isPlainObject(existing.default_config_json) ? existing.default_config_json : {},
        );
        const nextFormSchema = deepMergeDefaults(
          template.form_schema_json,
          isPlainObject(existing.form_schema_json) ? existing.form_schema_json : {},
        );

        const nextCapabilityJson = mergeCapabilityJson(nextCapability, {
          supports_control: existing.supports_control,
          supports_telemetry: existing.supports_telemetry,
          supports_location_report: existing.supports_location_report,
          remarks: existing.remarks,
        });
        const nextDefaultConfigJson = mergeDefaultConfigJson(nextDefaultConfig, {
          preferred_comm_identity_type: existing.preferred_comm_identity_type,
        });
        const nextStatus = existing.status === 'active' ? 'active' : template.enabled ? 'active' : existing.status;

        const changed =
          JSON.stringify(isPlainObject(existing.capability_json) ? existing.capability_json : {}) !== JSON.stringify(nextCapabilityJson) ||
          JSON.stringify(isPlainObject(existing.default_config_json) ? existing.default_config_json : {}) !== JSON.stringify(nextDefaultConfigJson) ||
          JSON.stringify(isPlainObject(existing.form_schema_json) ? existing.form_schema_json : {}) !== JSON.stringify(nextFormSchema) ||
          existing.type_name !== template.type_name ||
          existing.family !== template.device_category ||
          existing.status !== nextStatus;

        if (!changed) {
          unchanged += 1;
          continue;
        }

        await this.db.query(
          `
          update device_type
          set type_name = $3,
              family = $4,
              capability_json = $5,
              default_config_json = $6,
              form_schema_json = $7,
              status = $8,
              updated_at = now()
          where tenant_id = $1 and type_code = $2
          `,
          [
            TENANT_ID,
            template.type_code,
            existing.type_name || template.type_name,
            existing.family || template.device_category,
            JSON.stringify(nextCapabilityJson),
            JSON.stringify(nextDefaultConfigJson),
            JSON.stringify(nextFormSchema),
            nextStatus,
          ],
          client
        );
        updated += 1;
      }

      return { created, updated, unchanged };
    });
  }

  async standardCatalog() {
    const items = await Promise.all(
      STANDARD_DEVICE_TYPE_TEMPLATES.map(async (template) => {
        const existing = await this.getRowByTypeCode(template.type_code);
        return this.buildStandardCatalogItem(template, existing);
      }),
    );
    return {
      items,
      total: items.length,
    };
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
    if (dto.capability_json !== undefined && dto.capability_json !== null && !isPlainObject(dto.capability_json)) {
      fieldErrors.capability_json = ['capability_json must be an object'];
    }
    if (dto.default_config_json !== undefined && dto.default_config_json !== null && !isPlainObject(dto.default_config_json)) {
      fieldErrors.default_config_json = ['default_config_json must be an object'];
    }
    if (dto.form_schema_json !== undefined && dto.form_schema_json !== null && !isPlainObject(dto.form_schema_json)) {
      fieldErrors.form_schema_json = ['form_schema_json must be an object'];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }
  }

  async list(page = 1, pageSize = 20) {
    await this.ensureStandardCatalog();
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<Record<string, any>>(
      `
      select
        dt.id,
        dt.type_code,
        dt.type_name,
        dt.family,
        dt.capability_json,
        dt.default_config_json,
        dt.form_schema_json,
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
    await this.ensureStandardCatalog();
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
      const capabilityJson = mergeCapabilityJson({}, dto);
      const defaultConfigJson = mergeDefaultConfigJson({}, dto);
      const formSchemaJson = mergeFormSchemaJson({}, dto);
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
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id
        `,
        [
          TENANT_ID,
          typeCode,
          typeName,
          dto.device_category,
          JSON.stringify(capabilityJson),
          JSON.stringify(defaultConfigJson),
          JSON.stringify(formSchemaJson),
          dto.enabled === false ? 'draft' : 'active',
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
      const capabilityJson = mergeCapabilityJson(
        isPlainObject(existing.capability_json) ? existing.capability_json : {},
        dto,
      );
      const defaultConfigJson = mergeDefaultConfigJson(
        isPlainObject(existing.default_config_json) ? existing.default_config_json : {},
        dto,
      );
      const formSchemaJson = mergeFormSchemaJson(
        isPlainObject(existing.form_schema_json) ? existing.form_schema_json : {},
        dto,
      );
      await this.db.query(
        `
        update device_type
        set type_code = $3,
            type_name = $4,
            family = $5,
            capability_json = $6,
            default_config_json = $7,
            form_schema_json = $8,
            status = $9,
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          typeCode,
          typeName,
          dto.device_category ?? existing.family,
          JSON.stringify(capabilityJson),
          JSON.stringify(defaultConfigJson),
          JSON.stringify(formSchemaJson),
          dto.enabled === undefined ? existing.status : dto.enabled ? 'active' : 'draft',
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

  @Get('standard-catalog')
  async standardCatalog() {
    return ok(await this.service.standardCatalog());
  }

  @Get('options')
  async options() {
    const result = await this.service.list(1, 200);
    return result.items.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.device_type_name }));
  }

  @Post('bootstrap-standard-catalog')
  async bootstrapStandardCatalog() {
    const summary = await this.service.ensureStandardCatalog();
    const catalog = await this.service.standardCatalog();
    return ok({
      ...summary,
      items: catalog.items,
    });
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
