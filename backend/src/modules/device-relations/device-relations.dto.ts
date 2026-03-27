import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

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
  @IsUUID()
  source_device_id!: string;

  @IsUUID()
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
  @IsUUID()
  source_device_id?: string;

  @IsOptional()
  @IsUUID()
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
