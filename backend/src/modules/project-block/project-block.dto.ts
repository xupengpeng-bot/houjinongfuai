import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_STATUSES = ['active', 'inactive', 'draft'] as const;

export class CreateProjectBlockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  block_name!: string;

  @IsString()
  @Matches(UUID_LIKE, { message: 'project_id must be a UUID' })
  project_id!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  area_hectare?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  area_size?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  center_latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  center_longitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsString()
  @IsIn([...BLOCK_STATUSES])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class UpdateProjectBlockDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  block_name?: string;

  @IsOptional()
  @IsString()
  @Matches(UUID_LIKE, { message: 'project_id must be a UUID' })
  project_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  area_hectare?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  area_size?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  center_latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  center_longitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsString()
  @IsIn([...BLOCK_STATUSES])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}
