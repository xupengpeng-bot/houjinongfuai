import { IsArray, IsObject, IsOptional, IsString, Matches } from 'class-validator';

/** Frozen contract version string for client compatibility checks. */
export const SOLVER_CONTRACT_VERSION = 'solver-v2-published-network';

/** Accepts RFC-like hex UUID strings including fixed demo ids (version nibble may be 0). */
export const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SolverPreviewRequestDto {
  /** Solver input must bind to a **published** graph version persisted in Postgres (not ad-hoc canvas JSON). */
  @IsString()
  @Matches(UUID_LIKE)
  network_model_version_id!: string;

  @IsOptional()
  @Matches(UUID_LIKE)
  project_id?: string;

  @IsOptional()
  @Matches(UUID_LIKE)
  pump_valve_relation_id?: string;

  @IsOptional()
  @IsArray()
  @Matches(UUID_LIKE, { each: true })
  block_ids?: string[];

  @IsOptional()
  @IsObject()
  constraints?: Record<string, unknown>;
}

export class SolverPlanRequestDto extends SolverPreviewRequestDto {
  @IsOptional()
  @IsString()
  objective?: string;
}

export class SolverExplainRequestDto {
  @IsOptional()
  @Matches(UUID_LIKE)
  plan_id?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class SolverSimulateRequestDto {
  @IsOptional()
  @Matches(UUID_LIKE)
  plan_id?: string;

  @IsOptional()
  @IsObject()
  simulation_profile?: Record<string, unknown>;
}
