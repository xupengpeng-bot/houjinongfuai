import type { BlockScopeRow, DataScopePolicyRow, ProjectScopeRow } from './data-scope.dto';

export interface MergedScope {
  projectFullAccessIds: string[];
  blockExplicitAllowIds: string[];
  visibleProjectIds: string[];
  visibleBlockIds: string[];
}

/**
 * Pure merge: `data_scope_policy` allow rows + tenant catalog.
 * - Project-level allow: every block under that project is visible.
 * - Block-level allow: that block is visible; its project_id is listed for project pickers.
 * - Union of both.
 */
export function mergeProjectBlockScope(
  policies: DataScopePolicyRow[],
  projects: ProjectScopeRow[],
  blocks: BlockScopeRow[]
): MergedScope {
  const allowPolicies = policies.filter((p) => p.effect === 'allow');
  const projectFull = new Set<string>();
  const blockExplicit = new Set<string>();
  const projectsFromBlockPolicies = new Set<string>();

  for (const p of allowPolicies) {
    if (p.scope_type === 'project' && p.project_id) {
      projectFull.add(p.project_id);
    } else if (p.scope_type === 'block' && p.block_id && p.project_id) {
      blockExplicit.add(p.block_id);
      projectsFromBlockPolicies.add(p.project_id);
    }
  }

  const projectIdSet = new Set<string>([...projectFull, ...projectsFromBlockPolicies]);
  const visibleProjectIds = projects.filter((pr) => projectIdSet.has(pr.id)).map((p) => p.id);

  const visibleBlockIds: string[] = [];
  for (const b of blocks) {
    if (!projectIdSet.has(b.project_id)) continue;
    if (projectFull.has(b.project_id) || blockExplicit.has(b.id)) {
      visibleBlockIds.push(b.id);
    }
  }

  return {
    projectFullAccessIds: [...projectFull],
    blockExplicitAllowIds: [...blockExplicit],
    visibleProjectIds,
    visibleBlockIds
  };
}
