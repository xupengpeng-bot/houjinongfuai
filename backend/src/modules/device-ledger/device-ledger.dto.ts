import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

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
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @IsUUID()
  asset_id?: string;

  @IsOptional()
  @IsUUID()
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

  @IsUUID()
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
  @IsUUID()
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
