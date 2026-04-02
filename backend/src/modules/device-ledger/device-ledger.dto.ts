import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches } from 'class-validator';

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ListDevicesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page_size?: number;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  project_id?: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  asset_id?: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  device_type_id?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

export class CreateLedgerDeviceDto {
  @IsString()
  device_code!: string;

  @IsString()
  device_name!: string;

  /** UUID of device_type row, or type_code / type_name */
  @IsString()
  device_type!: string;

  @Matches(UUID_LIKE_PATTERN)
  asset_id!: string;

  @IsOptional()
  @IsString()
  manual_region_id?: string | null;

  @IsOptional()
  @IsString()
  manual_address_text?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  manual_latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  manual_longitude?: number | null;

  @IsOptional()
  @IsString()
  install_position_desc?: string | null;

  @IsOptional()
  @IsString()
  location_source_strategy?: string | null;
}

export class UpdateLedgerDeviceDto {
  @IsOptional()
  @IsString()
  device_name?: string;

  @IsOptional()
  @IsString()
  device_type?: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  asset_id?: string;

  @IsOptional()
  @IsString()
  manual_region_id?: string | null;

  @IsOptional()
  @IsString()
  manual_address_text?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  manual_latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  manual_longitude?: number | null;

  @IsOptional()
  @IsString()
  install_position_desc?: string | null;

  @IsOptional()
  @IsString()
  location_source_strategy?: string | null;
}

export class ArchiveLedgerDeviceDto {
  @IsOptional()
  @IsString()
  archive_reason?: string;

  @IsOptional()
  @IsString()
  reason_text?: string | null;

  @IsOptional()
  @IsString()
  trigger_type?: string;

  @IsOptional()
  @IsString()
  source_module?: string;

  @IsOptional()
  @IsString()
  source_action?: string;

  @IsOptional()
  @IsString()
  ui_entry?: string | null;

  @IsOptional()
  @IsString()
  request_id?: string | null;

  @IsOptional()
  @IsString()
  batch_id?: string | null;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  operator_id?: string | null;

  @IsOptional()
  @IsString()
  operator_name?: string | null;
}
