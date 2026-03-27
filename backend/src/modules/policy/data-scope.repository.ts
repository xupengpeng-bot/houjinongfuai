import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import type { BlockScopeRow, DataScopePolicyRow, ProjectScopeRow } from './data-scope.dto';

@Injectable()
export class DataScopeRepository {
  constructor(private readonly db: DatabaseService) {}

  async isTenantAdmin(tenantId: string, userId: string): Promise<boolean> {
    const r = await this.db.query<{ ok: boolean }>(
      `
      select exists(
        select 1
        from sys_user_role ur
        join sys_role sr on sr.id = ur.role_id
        where ur.tenant_id = $1
          and ur.user_id = $2
          and sr.role_type = 'tenant_admin'
      ) as ok
      `,
      [tenantId, userId]
    );
    return Boolean(r.rows[0]?.ok);
  }

  async countPoliciesForUser(tenantId: string, userId: string): Promise<number> {
    const r = await this.db.query<{ n: string }>(
      `
      select count(*)::text as n
      from data_scope_policy dsp
      where dsp.tenant_id = $1
        and dsp.effect = 'allow'
        and (
          (dsp.subject_type = 'user' and dsp.subject_id = $2)
          or (
            dsp.subject_type = 'role'
            and dsp.subject_id in (
              select ur.role_id from sys_user_role ur where ur.tenant_id = $1 and ur.user_id = $2
            )
          )
        )
      `,
      [tenantId, userId]
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  async findAllowPoliciesForUser(tenantId: string, userId: string): Promise<DataScopePolicyRow[]> {
    const r = await this.db.query<DataScopePolicyRow>(
      `
      select dsp.id, dsp.scope_type, dsp.project_id, dsp.block_id, dsp.effect
      from data_scope_policy dsp
      where dsp.tenant_id = $1
        and dsp.effect = 'allow'
        and (
          (dsp.subject_type = 'user' and dsp.subject_id = $2)
          or (
            dsp.subject_type = 'role'
            and dsp.subject_id in (
              select ur.role_id from sys_user_role ur where ur.tenant_id = $1 and ur.user_id = $2
            )
          )
        )
      order by dsp.scope_type asc, dsp.project_id asc, dsp.block_id asc nulls last
      `,
      [tenantId, userId]
    );
    return r.rows;
  }

  async listProjectsForTenant(tenantId: string): Promise<ProjectScopeRow[]> {
    const r = await this.db.query<ProjectScopeRow>(
      `
      select id, project_code, project_name, status
      from project
      where tenant_id = $1
      order by project_code asc
      `,
      [tenantId]
    );
    return r.rows;
  }

  async listBlocksForTenant(tenantId: string): Promise<BlockScopeRow[]> {
    const r = await this.db.query<BlockScopeRow>(
      `
      select id, project_id, block_code, block_name, status
      from project_block
      where tenant_id = $1
      order by project_id asc, block_code asc
      `,
      [tenantId]
    );
    return r.rows;
  }
}
