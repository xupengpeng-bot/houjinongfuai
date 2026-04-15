import { Body, Controller, Get, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';
import { BillingSubjectPolicyController } from './billing-subject-policy.controller';
import { BillingSubjectPolicyService } from './billing-subject-policy.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

interface BillingPackagePayload {
  packageCode?: string;
  packageName?: string;
  billingMode?: 'duration' | 'time' | 'volume' | 'water' | 'energy' | 'electric' | 'water_energy' | 'water_electric' | 'flat' | 'free';
  unitPrice?: number;
  unitType?: string;
  scopeType?: string;
  scopeRefId?: string;
  minChargeAmount?: number;
  name?: string;
  type?: 'duration' | 'time' | 'volume' | 'water' | 'energy' | 'electric' | 'water_energy' | 'water_electric' | 'free';
  unit?: string;
  price?: number;
  min_charge?: number;
  status?: 'active' | 'trial';
  pricing_rules_json?: Record<string, unknown>;
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

function normalizeBillingMode(value?: string) {
  if (
    value === 'duration' ||
    value === 'time' ||
    value === 'volume' ||
    value === 'water' ||
    value === 'energy' ||
    value === 'electric' ||
    value === 'water_energy' ||
    value === 'water_electric'
  ) {
    return value;
  }
  return 'free';
}

function buildPackageCode(name: string) {
  return (
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `BILL-${Date.now()}`
  );
}

@Injectable()
class BillingService {
  constructor(private readonly db: DatabaseService) {}

  private mapRow(row: Record<string, any>) {
    return {
      id: row.id,
      name: row.package_name,
      type: normalizeBillingMode(row.billing_mode),
      unit: row.unit_type,
      price: Number(row.unit_price),
      min_charge: Number(row.min_charge_amount),
      status: row.status === 'active' ? 'active' : 'trial',
      wells: Number(row.wells ?? 0),
      pricing_rules_json: row.pricing_rules_json ?? {}
    };
  }

  private async getRow(id: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        bp.*,
        (
          select count(*)::int
          from well_runtime_policy p
          where p.billing_package_id = bp.id
        ) as wells
      from billing_package bp
      where bp.tenant_id = $1 and bp.id = $2
      `,
      [TENANT_ID, id],
      client
    );
    return result.rows[0] ?? null;
  }

  private async ensureScopeRef(scopeType: string, scopeRefId?: string, client?: PoolClient) {
    if (scopeRefId?.trim()) {
      return scopeRefId.trim();
    }
    if (scopeType !== 'well') {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { scopeRefId: ['scopeRefId is required'] }
      });
    }
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from well
      where tenant_id = $1
      order by created_at asc
      limit 1
      `,
      [TENANT_ID],
      client
    );
    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { scopeRefId: ['scopeRefId is invalid'] }
      });
    }
    return row.id;
  }

  private validatePayload(dto: BillingPackagePayload, isCreate: boolean) {
    const fieldErrors: Record<string, string[]> = {};
    const name = dto.packageName?.trim() || dto.name?.trim();
    const mode = dto.billingMode || dto.type;
    const unit = dto.unitType?.trim() || dto.unit?.trim();
    const price = dto.unitPrice ?? dto.price;

    if (isCreate && !name) fieldErrors.name = ['name is required'];
    if (isCreate && !mode) fieldErrors.type = ['type is required'];
    if (isCreate && !unit) fieldErrors.unit = ['unit is required'];
    if (isCreate && (price === undefined || price === null)) fieldErrors.price = ['price is required'];
    if (
      mode &&
      !['duration', 'time', 'volume', 'water', 'energy', 'electric', 'water_energy', 'water_electric', 'flat', 'free'].includes(mode)
    ) {
      fieldErrors.type = ['type is invalid'];
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
        bp.*,
        (
          select count(*)::int
          from well_runtime_policy p
          where p.billing_package_id = bp.id
        ) as wells,
        count(*) over()::int as total_count
      from billing_package bp
      where bp.tenant_id = $1
      order by bp.created_at asc
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
      throw new NotFoundException('billing_package not found');
    }
    return this.mapRow(row);
  }

  async create(dto: BillingPackagePayload) {
    this.validatePayload(dto, true);
    const createdId = await this.db.withTransaction(async (client) => {
      const name = dto.packageName?.trim() || dto.name!.trim();
      const mode = dto.billingMode || dto.type || 'free';
      const unit = dto.unitType?.trim() || dto.unit!.trim();
      const price = Number(dto.unitPrice ?? dto.price ?? 0);
      const minCharge = Number(dto.minChargeAmount ?? dto.min_charge ?? 0);
      const scopeType = dto.scopeType?.trim() || 'well';
      const scopeRefId = await this.ensureScopeRef(scopeType, dto.scopeRefId, client);
      const packageCode = dto.packageCode?.trim() || buildPackageCode(name);

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into billing_package (
          tenant_id,
          package_code,
          package_name,
          billing_mode,
          unit_price,
          unit_type,
          min_charge_amount,
          pricing_rules_json,
          scope_type,
          scope_ref_id,
          status
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
        returning id
        `,
        [
          TENANT_ID,
          packageCode,
          name,
          mode === 'free' ? 'free' : mode,
          price,
          unit,
          minCharge,
          JSON.stringify(dto.pricing_rules_json ?? {}),
          scopeType,
          scopeRefId,
          dto.status === 'active' ? 'active' : 'draft'
        ],
        client
      );
      return inserted.rows[0].id;
    });
    return this.detail(createdId);
  }

  async update(id: string, dto: BillingPackagePayload) {
    this.validatePayload(dto, false);
    const existing = await this.getRow(id);
    if (!existing) {
      throw new NotFoundException('billing_package not found');
    }
    await this.db.withTransaction(async (client) => {
      const name = dto.packageName?.trim() || dto.name?.trim() || existing.package_name;
      const mode = dto.billingMode || dto.type || existing.billing_mode;
      const unit = dto.unitType?.trim() || dto.unit?.trim() || existing.unit_type;
      const price = Number(dto.unitPrice ?? dto.price ?? existing.unit_price);
      const minCharge = Number(dto.minChargeAmount ?? dto.min_charge ?? existing.min_charge_amount);
      const scopeType = dto.scopeType?.trim() || existing.scope_type;
      const scopeRefId = await this.ensureScopeRef(scopeType, dto.scopeRefId || existing.scope_ref_id, client);

      await this.db.query(
        `
        update billing_package
        set package_name = $3,
            billing_mode = $4,
            unit_price = $5,
            unit_type = $6,
            min_charge_amount = $7,
            pricing_rules_json = $8::jsonb,
            scope_type = $9,
            scope_ref_id = $10,
            status = $11,
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          name,
          mode === 'free' ? 'free' : mode,
          price,
          unit,
          minCharge,
          JSON.stringify(dto.pricing_rules_json ?? existing.pricing_rules_json ?? {}),
          scopeType,
          scopeRefId,
          dto.status === undefined ? existing.status : dto.status === 'active' ? 'active' : 'draft'
        ],
        client
      );
    });
    return this.detail(id);
  }
}

@Controller('billing-packages')
class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return ok(await this.service.list(parsePage(page), parsePageSize(pageSize)));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.service.detail(id));
  }

  @Post()
  async create(@Body() dto: BillingPackagePayload) {
    return ok(await this.service.create(dto));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: BillingPackagePayload) {
    return ok(await this.service.update(id, dto));
  }
}

@Module({
  controllers: [BillingController, BillingSubjectPolicyController],
  providers: [BillingService, BillingSubjectPolicyService],
  exports: [BillingSubjectPolicyService]
})
export class BillingModule {}
