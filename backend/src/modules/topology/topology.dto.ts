import { IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BlockingReason } from '../../common/contracts/runtime-decision';
import {
  TOPOLOGY_RELATION_TYPE_V1,
  type TopologyRelationTypeV1
} from './topology-relation-type-v1';

const RELATION_ROLE = ['primary', 'backup', 'forbidden'] as const;
const TOPOLOGY_V1_LIST = [...TOPOLOGY_RELATION_TYPE_V1] as string[];

/** Manual / reported / effective layers; `effective` is canonical for solver when set. */
export class TopologyRelationTypeStateBodyDto {
  @IsOptional()
  @IsIn(TOPOLOGY_V1_LIST)
  manual?: TopologyRelationTypeV1;

  @IsOptional()
  @IsIn(TOPOLOGY_V1_LIST)
  reported?: TopologyRelationTypeV1;

  @IsOptional()
  @IsIn(TOPOLOGY_V1_LIST)
  effective?: TopologyRelationTypeV1;
}

export class PumpValveRelationDto {
  @IsString()
  wellId!: string;

  @IsString()
  pumpId!: string;

  @IsString()
  valveId!: string;

  @IsIn(RELATION_ROLE)
  relationRole!: 'primary' | 'backup' | 'forbidden';

  @IsOptional()
  @ValidateNested()
  @Type(() => TopologyRelationTypeStateBodyDto)
  topology_relation_types?: TopologyRelationTypeStateBodyDto;
}

export class UpdatePumpValveRelationDto {
  @IsOptional()
  @IsIn(RELATION_ROLE)
  relationRole?: 'primary' | 'backup' | 'forbidden';

  @IsOptional()
  @ValidateNested()
  @Type(() => TopologyRelationTypeStateBodyDto)
  topology_relation_types?: TopologyRelationTypeStateBodyDto;
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
  wellFeatureModules?: string[] | null;
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

export interface PrimaryMeteringReadiness {
  blockId: string | null;
  blockName: string | null;
  meteringPointId: string | null;
  meteringPointCode: string | null;
  meteringPointStatus: string | null;
  primaryMeterDeviceId: string | null;
  primaryMeterDeviceName: string | null;
  primaryMeterLifecycleState: string | null;
  primaryMeterOnlineState: string | null;
}
