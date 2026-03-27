import { Injectable } from '@nestjs/common';
import type {
  DataScopeBlockOptionDto,
  DataScopeProjectOptionDto,
  DataScopeSummaryDto
} from './data-scope.dto';
import { DataScopeRepository } from './data-scope.repository';
import { mergeProjectBlockScope } from './data-scope.resolve';

/** Phase 1 dev default: matches `GET /auth/me` demo user. */
export const PHASE1_DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const PHASE1_DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000102';

@Injectable()
export class DataScopeService {
  constructor(private readonly repo: DataScopeRepository) {}

  async getSummary(tenantId: string, userId: string): Promise<DataScopeSummaryDto> {
    const [isAdmin, policyCount, policies, allProjects, allBlocks] = await Promise.all([
      this.repo.isTenantAdmin(tenantId, userId),
      this.repo.countPoliciesForUser(tenantId, userId),
      this.repo.findAllowPoliciesForUser(tenantId, userId),
      this.repo.listProjectsForTenant(tenantId),
      this.repo.listBlocksForTenant(tenantId)
    ]);

    const tenantAdminImplicitAll = isAdmin && policyCount === 0;
    if (tenantAdminImplicitAll) {
      return {
        tenant_id: tenantId,
        user_id: userId,
        scope_mode: 'tenant_full',
        tenant_admin_implicit_all: true,
        policy_row_count: 0,
        project_full_access_ids: allProjects.map((p) => p.id),
        block_explicit_allow_ids: [],
        visible_project_ids: allProjects.map((p) => p.id),
        visible_block_ids: allBlocks.map((b) => b.id),
        rules: {
          project_default:
            'tenant_admin with no data_scope_policy rows: all projects in tenant (implicit full catalog).',
          block_refinement: 'all blocks under those projects.'
        }
      };
    }

    const merged = mergeProjectBlockScope(policies, allProjects, allBlocks);
    return {
      tenant_id: tenantId,
      user_id: userId,
      scope_mode: 'policy',
      tenant_admin_implicit_all: false,
      policy_row_count: policyCount,
      project_full_access_ids: merged.projectFullAccessIds,
      block_explicit_allow_ids: merged.blockExplicitAllowIds,
      visible_project_ids: merged.visibleProjectIds,
      visible_block_ids: merged.visibleBlockIds,
      rules: {
        project_default:
          'scope_type=project + effect=allow grants read access to the project and all its blocks.',
        block_refinement:
          'scope_type=block + effect=allow grants that block (and exposes its project in project options).'
      }
    };
  }

  async listProjects(tenantId: string, userId: string): Promise<{ items: DataScopeProjectOptionDto[] }> {
    const summary = await this.getSummary(tenantId, userId);
    const all = await this.repo.listProjectsForTenant(tenantId);
    const allow = new Set(summary.visible_project_ids);
    const items = all.filter((p) => allow.has(p.id));
    return { items };
  }

  async listBlocks(
    tenantId: string,
    userId: string,
    projectId?: string
  ): Promise<{ items: DataScopeBlockOptionDto[] }> {
    const summary = await this.getSummary(tenantId, userId);
    const all = await this.repo.listBlocksForTenant(tenantId);
    const allow = new Set(summary.visible_block_ids);
    let items = all.filter((b) => allow.has(b.id));
    if (projectId) {
      items = items.filter((b) => b.project_id === projectId);
    }
    return { items };
  }
}
