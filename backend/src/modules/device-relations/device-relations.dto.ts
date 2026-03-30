import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches } from 'class-validator';

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ListDeviceRelationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page_size?: number;
}

export class CreateDeviceRelationDto {
  @Matches(UUID_LIKE_PATTERN)
  source_device_id!: string;

  @Matches(UUID_LIKE_PATTERN)
  target_device_id!: string;

  @IsString()
  relation_type!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priority?: number | null;

  @IsOptional()
  @IsString()
  sequence_rule?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  delay_seconds?: number | null;

  @IsOptional()
  @IsString()
  remarks?: string | null;
}

export class UpdateDeviceRelationDto {
  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  source_device_id?: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  target_device_id?: string;

  @IsOptional()
  @IsString()
  relation_type?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priority?: number | null;

  @IsOptional()
  @IsString()
  sequence_rule?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  delay_seconds?: number | null;

  @IsOptional()
  @IsString()
  remarks?: string | null;
}
