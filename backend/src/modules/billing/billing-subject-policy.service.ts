import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

export type BillingSubjectType = 'well' | 'pump' | 'valve';

type BillingSubjectPolicyRow = {
  id: string;
  subjectType: BillingSubjectType;
  subjectId: string;
  billingPackageId: string;
  billingPackageName: string;
  configSource: string;
  status: string;
};

type ProjectBillingSubjectOptionRow = {
  subjectId: string;
  subjectType: BillingSubjectType;
  subjectCode: string | null;
  subjectName: string | null;
  wellId: string | null;
  wellName: string | null;
  blockId: string | null;
  blockName: string | null;
  billingPackageId: string | null;
  billingPackageName: string | null;
};

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException({ requestId: 'local-dev', code, message, data }, status);
}

@Injectable()
export class BillingSubjectPolicyService {
  constructor(private readonly db: DatabaseService) {}

  normalizeSubjectType(value: string | null | undefined): BillingSubjectType | null {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'well' || normalized === 'pump' || normalized === 'valve') {
      return normalized;
    }
    return null;
  }

  private async ensureProjectExists(projectId: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from project
      where tenant_id = $1 and id = $2::uuid
      limit 1
      `,
      [TENANT_ID, projectId],
      client
    );
    if (!result.rows[0]) {
      throw new NotFoundException('project not found');
    }
  }

  private async getBillingPackage(input: { id: string; client?: PoolClient }) {
    const result = await this.db.query<{ id: string; packageName: string }>(
      `
      select
        id,
        package_name as "packageName"
      from billing_package
      where tenant_id = $1 and id = $2::uuid
      limit 1
      `,
      [TENANT_ID, input.id],
      input.client
    );
    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { billing_package_id: ['billing_package_id is invalid'] }
      });
    }
    return row;
  }

  async findActivePolicy(
    tenantId: string,
    subjectType: BillingSubjectType,
    subjectId: string,
    client?: PoolClient
  ): Promise<BillingSubjectPolicyRow | null> {
    const result = await this.db.query<BillingSubjectPolicyRow>(
      `
      select
        bsp.id,
        bsp.subject_type as "subjectType",
        bsp.subject_id::text as "subjectId",
        bsp.billing_package_id::text as "billingPackageId",
        bp.package_name as "billingPackageName",
        bsp.config_source as "configSource",
        bsp.status
      from billing_subject_policy bsp
      join billing_package bp
        on bp.id = bsp.billing_package_id
       and bp.tenant_id = bsp.tenant_id
      where bsp.tenant_id = $1::uuid
        and bsp.subject_type = $2
        and bsp.subject_id = $3::uuid
        and bsp.status = 'active'
      order by bsp.updated_at desc
      limit 1
      `,
      [tenantId, subjectType, subjectId],
      client
    );
    return result.rows[0] ?? null;
  }

  private buildProjectSubjectOptionsQuery(subjectType: BillingSubjectType) {
    if (subjectType === 'well') {
      return `
        select
          w.id::text as "subjectId",
          'well' as "subjectType",
          w.well_code as "subjectCode",
          coalesce(w.safety_profile_json->>'displayName', w.well_code) as "subjectName",
          w.id::text as "wellId",
          coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellName",
          pb.id::text as "blockId",
          pb.block_name as "blockName",
          bsp.billing_package_id::text as "billingPackageId",
          bp.package_name as "billingPackageName"
        from well w
        join project_block pb on pb.id = w.block_id and pb.tenant_id = w.tenant_id
        left join billing_subject_policy bsp
          on bsp.tenant_id = w.tenant_id
         and bsp.subject_type = 'well'
         and bsp.subject_id = w.id
         and bsp.status = 'active'
        left join billing_package bp on bp.id = bsp.billing_package_id
        where w.tenant_id = $1
          and pb.project_id = $2::uuid
        order by pb.block_name asc, coalesce(w.safety_profile_json->>'displayName', w.well_code) asc, w.created_at asc
      `;
    }

    if (subjectType === 'pump') {
      return `
        select
          p.id::text as "subjectId",
          'pump' as "subjectType",
          p.pump_code as "subjectCode",
          coalesce(pd.device_name, p.pump_code) as "subjectName",
          w.id::text as "wellId",
          coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellName",
          pb.id::text as "blockId",
          pb.block_name as "blockName",
          bsp.billing_package_id::text as "billingPackageId",
          bp.package_name as "billingPackageName"
        from pump p
        join well w on w.id = p.well_id and w.tenant_id = p.tenant_id
        join project_block pb on pb.id = w.block_id and pb.tenant_id = w.tenant_id
        left join device pd on pd.id = p.device_id
        left join billing_subject_policy bsp
          on bsp.tenant_id = p.tenant_id
         and bsp.subject_type = 'pump'
         and bsp.subject_id = p.id
         and bsp.status = 'active'
        left join billing_package bp on bp.id = bsp.billing_package_id
        where p.tenant_id = $1
          and pb.project_id = $2::uuid
        order by pb.block_name asc, coalesce(pd.device_name, p.pump_code) asc, p.created_at asc
      `;
    }

    return `
      select
        v.id::text as "subjectId",
        'valve' as "subjectType",
        v.valve_code as "subjectCode",
        coalesce(vd.device_name, v.valve_code) as "subjectName",
        w.id::text as "wellId",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellName",
        pb.id::text as "blockId",
        pb.block_name as "blockName",
        bsp.billing_package_id::text as "billingPackageId",
        bp.package_name as "billingPackageName"
      from valve v
      join well w on w.id = v.well_id and w.tenant_id = v.tenant_id
      join project_block pb on pb.id = w.block_id and pb.tenant_id = w.tenant_id
      left join device vd on vd.id = v.device_id
      left join billing_subject_policy bsp
        on bsp.tenant_id = v.tenant_id
       and bsp.subject_type = 'valve'
       and bsp.subject_id = v.id
       and bsp.status = 'active'
      left join billing_package bp on bp.id = bsp.billing_package_id
      where v.tenant_id = $1
        and pb.project_id = $2::uuid
      order by pb.block_name asc, coalesce(vd.device_name, v.valve_code) asc, v.created_at asc
    `;
  }

  private async listProjectSubjectOptionRows(
    projectId: string,
    subjectType: BillingSubjectType,
    client?: PoolClient
  ): Promise<ProjectBillingSubjectOptionRow[]> {
    await this.ensureProjectExists(projectId, client);
    const result = await this.db.query<ProjectBillingSubjectOptionRow>(
      this.buildProjectSubjectOptionsQuery(subjectType),
      [TENANT_ID, projectId],
      client
    );
    return result.rows;
  }

  async listProjectSubjectOptions(projectId: string, subjectType: BillingSubjectType, client?: PoolClient) {
    const rows = await this.listProjectSubjectOptionRows(projectId, subjectType, client);
    return rows.map((row) => ({
      subject_id: row.subjectId,
      subject_type: row.subjectType,
      subject_code: row.subjectCode,
      subject_name: row.subjectName,
      well_id: row.wellId,
      well_name: row.wellName,
      block_id: row.blockId,
      block_name: row.blockName,
      billing_package_id: row.billingPackageId,
      billing_package_name: row.billingPackageName
    }));
  }

  async batchApplyProject(input: {
    projectId: string;
    subjectType: BillingSubjectType;
    billingPackageId: string;
    subjectIds?: string[];
    overwrite?: boolean;
  }) {
    return this.db.withTransaction(async (client) => {
      const billingPackage = await this.getBillingPackage({ id: input.billingPackageId, client });
      const projectRows = await this.listProjectSubjectOptionRows(input.projectId, input.subjectType, client);
      if (projectRows.length === 0) {
        throw appException(HttpStatus.BAD_REQUEST, 'TARGET_NOT_FOUND', 'Project has no matching billing subjects', {
          project_id: input.projectId,
          subject_type: input.subjectType
        });
      }

      const requestedIds = (input.subjectIds ?? []).map((item) => item.trim()).filter(Boolean);
      const projectIdSet = new Set(projectRows.map((row) => row.subjectId));
      const invalidIds = requestedIds.filter((id) => !projectIdSet.has(id));
      if (invalidIds.length > 0) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: {
            subject_ids: ['subject_ids contains records outside the selected project']
          },
          invalid_subject_ids: invalidIds
        });
      }

      const targetRows =
        requestedIds.length > 0
          ? projectRows.filter((row) => requestedIds.includes(row.subjectId))
          : projectRows;

      if (targetRows.length === 0) {
        throw appException(HttpStatus.BAD_REQUEST, 'TARGET_NOT_FOUND', 'No billing subjects matched the request', {
          project_id: input.projectId,
          subject_type: input.subjectType
        });
      }

      const targetIds = targetRows.map((row) => row.subjectId);
      const existingPolicies = await this.db.query<{ subjectId: string }>(
        `
        select subject_id::text as "subjectId"
        from billing_subject_policy
        where tenant_id = $1
          and subject_type = $2
          and subject_id = any($3::uuid[])
        `,
        [TENANT_ID, input.subjectType, targetIds],
        client
      );
      const existingSubjectIds = new Set(existingPolicies.rows.map((row) => row.subjectId));
      const overwrite = input.overwrite ?? true;

      const applyResult = await this.db.query<{ subjectId: string }>(
        `
        insert into billing_subject_policy (
          tenant_id,
          subject_type,
          subject_id,
          billing_package_id,
          config_source,
          status
        )
        select
          $1::uuid,
          $2,
          subject_id::uuid,
          $3::uuid,
          'project_batch',
          'active'
        from unnest($4::text[]) as subject_id
        on conflict (tenant_id, subject_type, subject_id)
        ${overwrite
          ? `
            do update
              set billing_package_id = excluded.billing_package_id,
                  config_source = excluded.config_source,
                  status = 'active',
                  updated_at = now()
          `
          : 'do nothing'}
        returning subject_id::text as "subjectId"
        `,
        [TENANT_ID, input.subjectType, input.billingPackageId, targetIds],
        client
      );

      const affectedCount = applyResult.rows.length;
      const updatedCount = overwrite ? targetRows.filter((row) => existingSubjectIds.has(row.subjectId)).length : 0;
      const createdCount = overwrite ? affectedCount - updatedCount : affectedCount;
      const skippedCount = overwrite ? 0 : targetRows.length - affectedCount;

      return {
        project_id: input.projectId,
        subject_type: input.subjectType,
        billing_package_id: billingPackage.id,
        billing_package_name: billingPackage.packageName,
        overwrite,
        target_count: targetRows.length,
        affected_count: affectedCount,
        created_count: createdCount,
        updated_count: updatedCount,
        skipped_count: skippedCount
      };
    });
  }
}
