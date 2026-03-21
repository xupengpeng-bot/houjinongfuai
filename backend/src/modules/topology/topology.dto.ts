import { IsIn, IsOptional, IsString } from 'class-validator';
import { BlockingReason } from '../../common/contracts/runtime-decision';

export class PumpValveRelationDto {
  @IsString()
  wellId!: string;

  @IsString()
  pumpId!: string;

  @IsString()
  valveId!: string;

  @IsIn(['primary', 'backup', 'forbidden'])
  relationRole!: 'primary' | 'backup' | 'forbidden';
}

export class UpdatePumpValveRelationDto {
  @IsOptional()
  @IsIn(['primary', 'backup', 'forbidden'])
  relationRole?: 'primary' | 'backup' | 'forbidden';
}

export interface RelationContext {
  tenantId: string;
  relationId: string;
  wellId: string;
  pumpId: string;
  valveId: string;
  relationRole: string;
  billingInheritMode: string;
  relationConfigJson: Record<string, unknown>;
  wellDeviceState: string;
  pumpDeviceState: string;
  valveDeviceState: string;
  wellOnlineState: string;
  pumpOnlineState: string;
  valveOnlineState: string;
}

export interface RelationValidationResult {
  relation: RelationContext | null;
  blockingReasons: BlockingReason[];
}
