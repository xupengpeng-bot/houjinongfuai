import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class PolicyRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<Array<{
    id: string;
    wellId: string;
    billingPackageId: string;
    powerThresholdKw: number;
    minRunSeconds: number;
    maxRunSeconds: number;
    concurrencyLimit: number;
    status: string;
  }>> {
    const result = await this.db.query<{
      id: string;
      wellId: string;
      billingPackageId: string;
      powerThresholdKw: number;
      minRunSeconds: number;
      maxRunSeconds: number;
      concurrencyLimit: number;
      status: string;
    }>(`
      select
        p.id,
        p.well_id as "wellId",
        p.billing_package_id as "billingPackageId",
        p.power_threshold_kw as "powerThresholdKw",
        p.min_run_seconds as "minRunSeconds",
        p.max_run_seconds as "maxRunSeconds",
        p.concurrency_limit as "concurrencyLimit",
        p.status
      from well_runtime_policy p
      order by p.created_at desc
    `);
    return result.rows;
  }

  async create(input: {
    wellId: string;
    billingPackageId: string;
    powerThresholdKw: number;
    minRunSeconds: number;
    maxRunSeconds: number;
    concurrencyLimit: number;
  }) {
    const result = await this.db.query<{ id: string }>(
      `
      insert into well_runtime_policy (
        tenant_id, well_id, billing_package_id, power_threshold_kw,
        min_run_seconds, max_run_seconds, concurrency_limit, status
      )
      select
        w.tenant_id, $1, $2, $3, $4, $5, $6, 'active'
      from well w
      where w.id = $1
      returning id
      `,
      [
        input.wellId,
        input.billingPackageId,
        input.powerThresholdKw,
        input.minRunSeconds,
        input.maxRunSeconds,
        input.concurrencyLimit
      ]
    );
    return result.rows[0];
  }

  async update(id: string, input: Partial<{
    billingPackageId: string;
    powerThresholdKw: number;
    minRunSeconds: number;
    maxRunSeconds: number;
    concurrencyLimit: number;
  }>) {
    const sets: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (input.billingPackageId !== undefined) {
      sets.push(`billing_package_id = $${index++}`);
      values.push(input.billingPackageId);
    }
    if (input.powerThresholdKw !== undefined) {
      sets.push(`power_threshold_kw = $${index++}`);
      values.push(input.powerThresholdKw);
    }
    if (input.minRunSeconds !== undefined) {
      sets.push(`min_run_seconds = $${index++}`);
      values.push(input.minRunSeconds);
    }
    if (input.maxRunSeconds !== undefined) {
      sets.push(`max_run_seconds = $${index++}`);
      values.push(input.maxRunSeconds);
    }
    if (input.concurrencyLimit !== undefined) {
      sets.push(`concurrency_limit = $${index++}`);
      values.push(input.concurrencyLimit);
    }

    if (sets.length === 0) {
      const result = await this.db.query<{ id: string }>(`select id from well_runtime_policy where id = $1`, [id]);
      return result.rows[0];
    }

    values.push(id);
    const result = await this.db.query<{ id: string }>(
      `update well_runtime_policy set ${sets.join(', ')}, updated_at = now() where id = $${index} returning id`,
      values
    );
    return result.rows[0];
  }

  async findEffectivePolicyByWellId(wellId: string) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      wellId: string;
      billingPackageId: string;
      powerThresholdKw: number;
      minRunSeconds: number;
      maxRunSeconds: number;
      concurrencyLimit: number;
      stopProtectionMode: string;
      safetyRuleJson: Record<string, unknown>;
      billingMode: string;
      unitPrice: number;
      unitType: string;
      minChargeAmount: number;
    }>(
      `
      select
        p.id,
        p.tenant_id as "tenantId",
        p.well_id as "wellId",
        p.billing_package_id as "billingPackageId",
        p.power_threshold_kw as "powerThresholdKw",
        p.min_run_seconds as "minRunSeconds",
        p.max_run_seconds as "maxRunSeconds",
        p.concurrency_limit as "concurrencyLimit",
        p.stop_protection_mode as "stopProtectionMode",
        p.safety_rule_json as "safetyRuleJson",
        bp.billing_mode as "billingMode",
        bp.unit_price as "unitPrice",
        bp.unit_type as "unitType",
        bp.min_charge_amount as "minChargeAmount"
      from well_runtime_policy p
      join billing_package bp on bp.id = p.billing_package_id
      where p.well_id = $1 and p.status = 'active'
      order by p.updated_at desc
      limit 1
      `,
      [wellId]
    );
    return result.rows[0] ?? null;
  }

  async findRelationConfigById(relationId: string) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      billingInheritMode: string;
      relationConfigJson: Record<string, unknown>;
    }>(
      `
      select
        id,
        tenant_id as "tenantId",
        billing_inherit_mode as "billingInheritMode",
        relation_config_json as "relationConfigJson"
      from pump_valve_relation
      where id = $1 and status = 'active'
      `,
      [relationId]
    );
    return result.rows[0] ?? null;
  }

  async findInteractionPolicy(tenantId: string, targetType: string, sceneCode: string) {
    const result = await this.db.query<{
      id: string;
      confirmMode: string;
      promptJson: Record<string, unknown>;
    }>(
      `
      select
        id,
        confirm_mode as "confirmMode",
        prompt_json as "promptJson"
      from interaction_policy
      where tenant_id = $1
        and target_type = $2
        and scene_code = $3
        and status = 'active'
      order by updated_at desc
      limit 1
      `,
      [tenantId, targetType, sceneCode]
    );
    return result.rows[0] ?? null;
  }

  async findScenarioTemplate(tenantId: string, templateCode: string | null, targetFamily: string) {
    if (!templateCode) {
      return null;
    }

    const result = await this.db.query<{
      id: string;
      templateCode: string;
      templateName: string;
      targetFamily: string;
      templateConfigJson: Record<string, unknown>;
    }>(
      `
      select
        id,
        template_code as "templateCode",
        template_name as "templateName",
        target_family as "targetFamily",
        template_config_json as "templateConfigJson"
      from scenario_template
      where tenant_id = $1
        and template_code = $2
        and target_family = $3
        and status = 'active'
      order by updated_at desc
      limit 1
      `,
      [tenantId, templateCode, targetFamily]
    );
    return result.rows[0] ?? null;
  }

  async findDeviceTypeDefaultByWellId(wellId: string) {
    const result = await this.db.query<{
      id: string;
      typeCode: string;
      family: string;
      defaultConfigJson: Record<string, unknown>;
    }>(
      `
      select
        dt.id,
        dt.type_code as "typeCode",
        dt.family,
        dt.default_config_json as "defaultConfigJson"
      from well w
      join device d on d.id = w.device_id
      join device_type dt on dt.id = d.device_type_id
      where w.id = $1
      limit 1
      `,
      [wellId]
    );
    return result.rows[0] ?? null;
  }

  async findBillingPackageById(billingPackageId: string) {
    const result = await this.db.query<{
      id: string;
      packageCode: string;
      packageName: string;
      billingMode: string;
      unitPrice: number;
      unitType: string;
      minChargeAmount: number;
      status: string;
    }>(
      `
      select
        id,
        package_code as "packageCode",
        package_name as "packageName",
        billing_mode as "billingMode",
        unit_price as "unitPrice",
        unit_type as "unitType",
        min_charge_amount as "minChargeAmount",
        status
      from billing_package
      where id = $1 and status = 'active'
      limit 1
      `,
      [billingPackageId]
    );
    return result.rows[0] ?? null;
  }
}
