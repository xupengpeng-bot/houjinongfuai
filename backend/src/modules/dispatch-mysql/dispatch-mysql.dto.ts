import { Type } from 'class-transformer';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Allowed values for `dispatch_task.status` (conservative whitelist). */
export const DISPATCH_TASK_STATUS_WHITELIST = new Set([
  'active',
  'waiting_verify',
  'closed',
  'paused',
  'blocked',
  'draft_local_only',
  'synced_ready'
]);

export class DispatchTaskStatusBodyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  status!: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  sync_team?: boolean;
}

export class DispatchTaskResultSummaryBodyDto {
  @IsObject()
  summary!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  artifact_ref?: string;
}
