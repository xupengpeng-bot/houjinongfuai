import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query
} from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';
import { DataScopeController } from './data-scope.controller';
import { DataScopeRepository } from './data-scope.repository';
import { DataScopeService } from './data-scope.service';
import { EffectivePolicyResolver } from './effective-policy.resolver';
import { WellRuntimePolicyReadModel, WellRuntimePolicyStatus } from './policy.dto';
import { PolicyRepository } from './policy.repository';
import { BillingModule } from '../billing/billing.module';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

interface PolicyPayload {
  wellId?: string;
  billingPackageId?: string;
  powerThresholdKw?: number;
  minRunSeconds?: number;
  maxRunSeconds?: number;
  concurrencyLimit?: number;
  status?: WellRuntimePolicyStatus;
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

function normalizeStatus(value?: string): WellRuntimePolicyStatus {
  if (value === 'active' || value === 'inactive' || value === 'draft') {
    return value;
  }
  return 'draft';
}

@Injectable()
class PolicyUiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly policyRepository: PolicyRepository,
    private readonly policyResolver: EffectivePolicyResolver
  ) {}

  private mapRow(row: Record<string, any>): WellRuntimePolicyReadModel {
    return {
      id: row.id,
      wellId: row.wellId,
      billingPackageId: row.billingPackageId,
      powerThresholdKw: Number(row.powerThresholdKw ?? 0),
      minRunSeconds: Number(row.minRunSeconds ?? 0),
      maxRunSeconds: Number(row.maxRunSeconds ?? 0),
      concurrencyLimit: Number(row.concurrencyLimit ?? 0),
      stopProtectionMode: String(row.stopProtectionMode ?? 'stop_pump_then_close_valve'),
      safetyRuleJson: row.safetyRuleJson ?? {},
      status: normalizeStatus(row.status)
    };
  }

  private validatePayload(dto: PolicyPayload, isCreate: boolean) {
    const fieldErrors: Record<string, string[]> = {};
    if (isCreate && !dto.wellId?.trim()) fieldErrors.wellId = ['wellId is required'];
    if (isCreate && !dto.billingPackageId?.trim()) fieldErrors.billingPackageId = ['billingPackageId is required'];
    if (isCreate && (dto.powerThresholdKw === undefined || dto.powerThresholdKw === null)) {
      fieldErrors.powerThresholdKw = ['powerThresholdKw is required'];
    }
    if (isCreate && (dto.minRunSeconds === undefined || dto.minRunSeconds === null)) {
      fieldErrors.minRunSeconds = ['minRunSeconds is required'];
    }
    if (isCreate && (dto.maxRunSeconds === undefined || dto.maxRunSeconds === null)) {
      fieldErrors.maxRunSeconds = ['maxRunSeconds is required'];
    }
    if (isCreate && (dto.concurrencyLimit === undefined || dto.concurrencyLimit === null)) {
      fieldErrors.concurrencyLimit = ['concurrencyLimit is required'];
    }
    if (dto.powerThresholdKw !== undefined && Number(dto.powerThresholdKw) < 0) {
      fieldErrors.powerThresholdKw = ['powerThresholdKw must be >= 0'];
    }
    if (dto.minRunSeconds !== undefined && Number(dto.minRunSeconds) < 0) {
      fieldErrors.minRunSeconds = ['minRunSeconds must be >= 0'];
    }
    if (dto.maxRunSeconds !== undefined && Number(dto.maxRunSeconds) < 1) {
      fieldErrors.maxRunSeconds = ['maxRunSeconds must be >= 1'];
    }
    if (dto.concurrencyLimit !== undefined && Number(dto.concurrencyLimit) < 1) {
      fieldErrors.concurrencyLimit = ['concurrencyLimit must be >= 1'];
    }
    if (
      dto.minRunSeconds !== undefined &&
      dto.maxRunSeconds !== undefined &&
      Number(dto.maxRunSeconds) < Number(dto.minRunSeconds)
    ) {
      fieldErrors.maxRunSeconds = ['maxRunSeconds must be >= minRunSeconds'];
    }
    if (dto.status && !['active', 'inactive'].includes(dto.status)) {
      fieldErrors.status = ['status is invalid'];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }
  }

  private async ensureWellExists(id: string) {
    const result = await this.db.query<{ id: string }>(
      `select id from well where tenant_id = $1 and id = $2 limit 1`,
      [TENANT_ID, id]
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { wellId: ['wellId is invalid'] }
      });
    }
  }

  private async ensureBillingPackageExists(id: string) {
    const result = await this.db.query<{ id: string }>(
      `select id from billing_package where tenant_id = $1 and id = $2 limit 1`,
      [TENANT_ID, id]
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { billingPackageId: ['billingPackageId is invalid'] }
      });
    }
  }

  private async fetchRow(id: string) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        p.id,
        p.well_id as "wellId",
        p.billing_package_id as "billingPackageId",
        p.power_threshold_kw as "powerThresholdKw",
        p.min_run_seconds as "minRunSeconds",
        p.max_run_seconds as "maxRunSeconds",
        p.concurrency_limit as "concurrencyLimit",
        p.stop_protection_mode as "stopProtectionMode",
        coalesce(p.safety_rule_json, '{}'::jsonb) as "safetyRuleJson",
        p.status
      from well_runtime_policy p
      where p.id = $1
      limit 1
      `,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async list(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<Record<string, any>>(
      `
      select
        p.id,
        p.well_id as "wellId",
        p.billing_package_id as "billingPackageId",
        p.power_threshold_kw as "powerThresholdKw",
        p.min_run_seconds as "minRunSeconds",
        p.max_run_seconds as "maxRunSeconds",
        p.concurrency_limit as "concurrencyLimit",
        p.status,
        count(*) over()::int as total_count
      from well_runtime_policy p
      where p.tenant_id = $1
      order by p.created_at desc
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
    const row = await this.fetchRow(id);
    if (!row) throw new NotFoundException('well_runtime_policy not found');
    return this.mapRow(row);
  }

  async activate(id: string) {
    const existing = await this.fetchRow(id);
    if (!existing) throw new NotFoundException('well_runtime_policy not found');

    await this.db.query(
      `
      update well_runtime_policy
      set status = 'active',
          effective_from = coalesce(effective_from, now()),
          effective_to = null,
          updated_at = now()
      where id = $1
      `,
      [id]
    );

    return this.detail(id);
  }

  async disable(id: string) {
    const existing = await this.fetchRow(id);
    if (!existing) throw new NotFoundException('well_runtime_policy not found');

    await this.db.query(
      `
      update well_runtime_policy
      set status = 'inactive',
          effective_to = now(),
          updated_at = now()
      where id = $1
      `,
      [id]
    );

    return this.detail(id);
  }

  async create(dto: PolicyPayload) {
    this.validatePayload(dto, true);
    await this.ensureWellExists(dto.wellId!);
    await this.ensureBillingPackageExists(dto.billingPackageId!);

    const inserted = await this.db.query<{ id: string }>(
      `
      insert into well_runtime_policy (
        tenant_id,
        well_id,
        billing_package_id,
        power_threshold_kw,
        min_run_seconds,
        max_run_seconds,
        concurrency_limit,
        status
      ) values ($1,$2,$3,$4,$5,$6,$7,$8)
      returning id
      `,
      [
        TENANT_ID,
        dto.wellId,
        dto.billingPackageId,
        Number(dto.powerThresholdKw),
        Number(dto.minRunSeconds),
        Number(dto.maxRunSeconds),
        Number(dto.concurrencyLimit),
        dto.status === 'active' ? 'active' : 'draft'
      ]
    );
    return this.detail(inserted.rows[0].id);
  }

  async update(id: string, dto: PolicyPayload) {
    this.validatePayload(dto, false);
    const existing = await this.fetchRow(id);
    if (!existing) throw new NotFoundException('well_runtime_policy not found');

    if (dto.wellId && dto.wellId !== existing.wellId) {
      await this.ensureWellExists(dto.wellId);
    }
    if (dto.billingPackageId && dto.billingPackageId !== existing.billingPackageId) {
      await this.ensureBillingPackageExists(dto.billingPackageId);
    }

    const nextMinRunSeconds = Number(dto.minRunSeconds ?? existing.minRunSeconds);
    const nextMaxRunSeconds = Number(dto.maxRunSeconds ?? existing.maxRunSeconds);
    if (nextMaxRunSeconds < nextMinRunSeconds) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { maxRunSeconds: ['maxRunSeconds must be >= minRunSeconds'] }
      });
    }

    await this.db.query(
      `
      update well_runtime_policy
      set well_id = $2,
          billing_package_id = $3,
          power_threshold_kw = $4,
          min_run_seconds = $5,
          max_run_seconds = $6,
          concurrency_limit = $7,
          status = $8,
          updated_at = now()
      where id = $1
      `,
      [
        id,
        dto.wellId ?? existing.wellId,
        dto.billingPackageId ?? existing.billingPackageId,
        Number(dto.powerThresholdKw ?? existing.powerThresholdKw),
        nextMinRunSeconds,
        nextMaxRunSeconds,
        Number(dto.concurrencyLimit ?? existing.concurrencyLimit),
        dto.status === undefined ? existing.status : dto.status === 'active' ? 'active' : 'draft'
      ]
    );

    return this.detail(id);
  }

  async preview(id: string) {
    const row = await this.fetchRow(id);
    if (!row) {
      throw new NotFoundException('well_runtime_policy not found');
    }

    const policy = this.mapRow(row);
    const relation = await this.policyRepository.findPrimaryRelationByWellId(policy.wellId);
    if (!relation) {
      return {
        id,
        effective_rule_source: {
          policy_id: policy.id,
          relation_id: null,
          interaction_policy_id: null,
          scenario_template_id: null,
          device_type_id: null,
          billing_package_id: policy.billingPackageId,
          priority_chain: ['billing_subject_policy', 'well_runtime_policy', 'pump_valve_relation', 'interaction_policy', 'scenario_template', 'device_type_default']
        },
        effective_rule_snapshot: {
          priority_chain: ['billing_subject_policy', 'well_runtime_policy', 'pump_valve_relation', 'interaction_policy', 'scenario_template', 'device_type_default'],
          policy,
          relation: null,
          note: 'No active pump-valve relation found for this well'
        }
      };
    }

    try {
      const resolved = await this.policyResolver.resolveForRuntime({
        wellId: policy.wellId,
        pumpId: relation.pumpId,
        valveId: relation.valveId,
        relationId: relation.relationId,
        targetType: 'well',
        sceneCode: 'farmer_scan_start'
      });

      return {
        id,
        effective_rule_source: {
          policy_id: resolved.sourceIds.policyId ?? policy.id,
          relation_id: relation.relationId,
          interaction_policy_id: resolved.sourceIds.interactionPolicyId ?? null,
          scenario_template_id: resolved.sourceIds.scenarioTemplateId ?? null,
          device_type_id: resolved.sourceIds.deviceTypeId ?? null,
          billing_package_id: resolved.sourceIds.billingPackageId,
          priority_chain: [...resolved.priorityChain]
        },
        effective_rule_snapshot: {
          priority_chain: [...resolved.priorityChain],
          source_ids: resolved.sourceIds,
          runtime: resolved.runtime,
          billing: resolved.billing,
          interaction: resolved.interaction,
          resolved_from: resolved.resolved_from,
          raw: resolved.raw,
          policy,
          relation
        }
      };
    } catch (error) {
      if (error instanceof HttpException) {
        const payload = error.getResponse() as { code?: string; message?: string; data?: Record<string, unknown> };
        return {
          id,
          effective_rule_source: {
            policy_id: policy.id,
            relation_id: relation.relationId,
            interaction_policy_id: null,
            scenario_template_id: null,
            device_type_id: null,
            billing_package_id: policy.billingPackageId,
            priority_chain: ['billing_subject_policy', 'well_runtime_policy', 'pump_valve_relation', 'interaction_policy', 'scenario_template', 'device_type_default']
          },
          effective_rule_snapshot: {
            priority_chain: ['billing_subject_policy', 'well_runtime_policy', 'pump_valve_relation', 'interaction_policy', 'scenario_template', 'device_type_default'],
            policy,
            relation,
            resolution_error: {
              code: payload.code ?? 'POLICY_NOT_EFFECTIVE',
              message: payload.message ?? 'effective runtime policy could not be resolved',
              data: payload.data ?? {}
            }
          }
        };
      }
      throw error;
    }
  }
}

@Controller('well-runtime-policies')
class PolicyController {
  constructor(private readonly policyUiService: PolicyUiService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return ok(await this.policyUiService.list(parsePage(page), parsePageSize(pageSize)));
  }

  @Post()
  async create(@Body() dto: PolicyPayload) {
    return ok(await this.policyUiService.create(dto));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.policyUiService.detail(id));
  }

  @Get(':id/effective-preview')
  async preview(@Param('id') id: string) {
    return ok(await this.policyUiService.preview(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: PolicyPayload) {
    return ok(await this.policyUiService.update(id, dto));
  }

  @Post(':id/activate')
  async activate(@Param('id') id: string) {
    return ok(await this.policyUiService.activate(id));
  }

  @Post(':id/disable')
  async disable(@Param('id') id: string) {
    return ok(await this.policyUiService.disable(id));
  }
}

@Module({
  imports: [BillingModule],
  controllers: [PolicyController, DataScopeController],
  providers: [PolicyRepository, EffectivePolicyResolver, DataScopeRepository, DataScopeService, PolicyUiService],
  exports: [PolicyRepository, EffectivePolicyResolver, DataScopeRepository, DataScopeService]
})
export class PolicyModule {}
