import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

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
  block_id?: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  asset_id?: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  device_type_id?: string;

  @IsOptional()
  @IsIn(['online', 'offline', 'alarm'])
  display_status?: 'online' | 'offline' | 'alarm';

  @IsOptional()
  @IsString()
  q?: string;
}

class LedgerDeviceConfigFieldsDto {
  @IsOptional()
  @IsString()
  software_family?: string | null;

  @IsOptional()
  @IsString()
  software_version?: string | null;

  @IsOptional()
  @IsString()
  hardware_sku?: string | null;

  @IsOptional()
  @IsString()
  hardware_rev?: string | null;

  @IsOptional()
  @IsString()
  firmware_family?: string | null;

  @IsOptional()
  @IsString()
  meter_protocol?: string | null;

  @IsOptional()
  @IsString()
  control_protocol?: string | null;

  @IsOptional()
  @IsString()
  controller_role?: string | null;

  @IsOptional()
  @IsString()
  deployment_mode?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  config_version?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  capability_version?: number | null;

  @IsOptional()
  @IsString()
  capability_hash?: string | null;

  @IsOptional()
  @IsString()
  config_bitmap?: string | null;

  @IsOptional()
  @IsString()
  actions_bitmap?: string | null;

  @IsOptional()
  @IsString()
  queries_bitmap?: string | null;

  @IsOptional()
  @IsArray()
  feature_modules?: string[] | null;

  @IsOptional()
  @IsObject()
  capability_limits?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  resource_inventory?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  control_config?: Record<string, unknown> | null;

  @IsOptional()
  @IsArray()
  channel_bindings?: unknown[] | null;

  @IsOptional()
  @IsObject()
  runtime_rules?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  last_register_payload?: Record<string, unknown> | null;

  @IsOptional()
  @IsBoolean()
  auto_identified?: boolean | null;
}

export class CreateLedgerDeviceDto extends LedgerDeviceConfigFieldsDto {
  @IsString()
  device_code!: string;

  @IsString()
  device_name!: string;

  @IsOptional()
  @IsString()
  imei?: string | null;

  /** UUID of device_type row, or type_code / type_name */
  @IsString()
  device_type!: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  asset_id?: string | null;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  project_id?: string | null;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  block_id?: string | null;

  @IsOptional()
  @IsString()
  source_module?: string | null;

  @IsOptional()
  @IsString()
  source_node_code?: string | null;

  @IsOptional()
  @IsString()
  source_unit_code?: string | null;

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

export class UpdateLedgerDeviceDto extends LedgerDeviceConfigFieldsDto {
  @IsOptional()
  @IsString()
  device_name?: string;

  @IsOptional()
  @IsString()
  imei?: string | null;

  @IsOptional()
  @IsString()
  device_type?: string;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  asset_id?: string | null;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  project_id?: string | null;

  @IsOptional()
  @Matches(UUID_LIKE_PATTERN)
  block_id?: string | null;

  @IsOptional()
  @IsString()
  source_module?: string | null;

  @IsOptional()
  @IsString()
  source_node_code?: string | null;

  @IsOptional()
  @IsString()
  source_unit_code?: string | null;

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
