import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class WellRuntimePolicyDto {
  @IsString()
  wellId!: string;

  @IsString()
  billingPackageId!: string;

  @IsNumber()
  powerThresholdKw!: number;

  @IsInt()
  @Min(0)
  minRunSeconds!: number;

  @IsInt()
  @Min(1)
  maxRunSeconds!: number;

  @IsInt()
  @Min(1)
  concurrencyLimit!: number;
}

export class UpdateWellRuntimePolicyDto {
  @IsOptional()
  @IsString()
  billingPackageId?: string;

  @IsOptional()
  @IsNumber()
  powerThresholdKw?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minRunSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRunSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  concurrencyLimit?: number;
}

export interface EffectivePolicy {
  priorityChain: string[];
  sourceIds: {
    policyId?: string;
    relationId: string;
    interactionPolicyId?: string;
    scenarioTemplateId?: string;
    deviceTypeId?: string;
    billingPackageId: string;
  };
  runtime: {
    wellId: string;
    pumpId: string;
    valveId: string;
    powerThresholdKw: number;
    minRunSeconds: number;
    maxRunSeconds: number;
    concurrencyLimit: number;
    idleTimeoutSeconds: number;
    stopProtectionMode: string;
  };
  billing: {
    billingPackageId: string;
    billingMode: string;
    unitPrice: number;
    unitType: string;
    minChargeAmount: number;
  };
  interaction: {
    confirmMode: string;
  };
  resolved_from: {
    billing_package_source?: string;
    max_session_minutes_source?: string;
    idle_timeout_seconds_source?: string;
    concurrency_limit_source?: string;
    min_run_seconds_source?: string;
    power_threshold_kw_source?: string;
    stop_protection_mode_source?: string;
    confirm_mode_source?: string;
  };
  raw: {
    wellRuntimePolicy: Record<string, unknown> | null;
    relationConfig: Record<string, unknown>;
    interactionPolicy: Record<string, unknown> | null;
    scenarioTemplate: Record<string, unknown> | null;
    deviceTypeDefault: Record<string, unknown> | null;
    billingPackage: Record<string, unknown>;
  };
}
