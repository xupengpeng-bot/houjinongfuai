import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf
} from 'class-validator';

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

/** Next task may only auto-activate from these statuses (conservative). */
export const DISPATCH_TASK_ACTIVATABLE_STATUSES = new Set(['synced_ready', 'draft_local_only']);

export class DispatchTaskStatusBodyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  status!: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  sync_team?: boolean;

  /** When closing with `status: closed`, atomically activate `next_task_id` if valid. */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  auto_activate_next?: boolean;
}

export class DispatchTaskSequencingBodyDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(64)
  next_task_id?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(64)
  depends_on_task_id?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  queue_order?: number | null;
}

export class DispatchTaskResultSummaryBodyDto {
  @IsObject()
  summary!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  artifact_ref?: string;
}
