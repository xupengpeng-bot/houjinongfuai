/** Rows from `data_scope_policy` relevant to project/block read scope. */
export interface DataScopePolicyRow {
  id: string;
  scope_type: 'project' | 'block';
  project_id: string;
  block_id: string | null;
  effect: string;
}

export interface ProjectScopeRow {
  id: string;
  project_code: string;
  project_name: string;
  status: string;
}

export interface BlockScopeRow {
  id: string;
  project_id: string;
  block_code: string;
  block_name: string;
  status: string;
}

/** Effective scope summary for `/ops/data-scope/summary`. */
export interface DataScopeSummaryDto {
  tenant_id: string;
  user_id: string;
  scope_mode: 'tenant_full' | 'policy';
  tenant_admin_implicit_all: boolean;
  policy_row_count: number;
  project_full_access_ids: string[];
  block_explicit_allow_ids: string[];
  visible_project_ids: string[];
  visible_block_ids: string[];
  rules: {
    project_default: string;
    block_refinement: string;
  };
}

export interface DataScopeProjectOptionDto {
  id: string;
  project_code: string;
  project_name: string;
  status: string;
}

export interface DataScopeBlockOptionDto {
  id: string;
  project_id: string;
  block_code: string;
  block_name: string;
  status: string;
}
