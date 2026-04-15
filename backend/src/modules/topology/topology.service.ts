import { Injectable } from '@nestjs/common';
import { BlockingReason, createBlockingReason } from '../../common/contracts/runtime-decision';
import {
  isDeviceActiveAndOnline,
  isRoleControllable,
  supportsIntegratedPumpValveControl,
} from '../../common/device-control-routing';
import { ErrorCodes } from '../../common/errors/error-codes';
import { PrimaryMeteringReadiness, RelationValidationResult } from './topology.dto';
import { TopologyRepository } from './topology.repository';

@Injectable()
export class TopologyService {
  constructor(private readonly topologyRepository: TopologyRepository) {}

  private supportsIntegratedWellController(relation: RelationValidationResult['relation']) {
    return supportsIntegratedPumpValveControl(relation?.wellFeatureModules);
  }

  async findPrimaryMeteringReadinessByWellId(wellId: string): Promise<PrimaryMeteringReadiness | null> {
    return this.topologyRepository.findPrimaryMeteringReadinessByWellId(wellId);
  }

  private relationMatchesTarget(
    relation: RelationValidationResult['relation'],
    targetType: 'valve' | 'well' | 'pump' | 'session',
    targetId: string
  ) {
    if (!relation) return false;
    if (targetType === 'valve') return relation.valveId === targetId;
    if (targetType === 'pump') return relation.pumpId === targetId;
    if (targetType === 'well') return relation.wellId === targetId;
    return false;
  }

  async validateStartTarget(
    targetType: 'valve' | 'well' | 'pump' | 'session',
    targetId: string,
    relationId?: string | null
  ): Promise<RelationValidationResult> {
    if (targetType === 'session') {
      return {
        relation: null,
        blockingReasons: [
          createBlockingReason(
            ErrorCodes.VALIDATION_ERROR,
            'session target is not supported for start-check in phase 1',
            'runtime'
          )
        ]
      };
    }

    const relation =
      relationId && relationId.trim()
        ? await this.topologyRepository.findRelationById(relationId.trim())
        : targetType === 'valve'
          ? await this.topologyRepository.findRelationByValveId(targetId)
          : targetType === 'pump'
            ? await this.topologyRepository.findRelationByPumpId(targetId)
            : await this.topologyRepository.findPrimaryRelationByWellId(targetId);

    if (!relation || !this.relationMatchesTarget(relation, targetType, targetId)) {
      return {
        relation: null,
        blockingReasons: [
          createBlockingReason(
            ErrorCodes.RELATION_NOT_CONFIGURED,
            relationId ? 'The resolved pump-valve relation no longer matches the target' : 'No active pump-valve relation was found for the target',
            'topology'
          )
        ]
      };
    }

    const blockingReasons: BlockingReason[] = [];
    const integratedWellController = this.supportsIntegratedWellController(relation);
    if (relation.relationRole === 'forbidden') {
      blockingReasons.push(
        createBlockingReason(ErrorCodes.RELATION_FORBIDDEN, 'The relation is marked as forbidden', 'topology')
      );
    }

    if (!isDeviceActiveAndOnline(relation.wellDeviceState, relation.wellOnlineState)) {
      blockingReasons.push(
        createBlockingReason(
          ErrorCodes.DEVICE_OFFLINE,
          'well device is not active and online',
          'topology',
          {
            deviceRole: 'well',
            lifecycleState: relation.wellDeviceState,
            onlineState: relation.wellOnlineState
          }
        )
      );
    }

    if (
      !isRoleControllable({
        role: 'pump',
        wellFeatureModules: relation.wellFeatureModules,
        wellDeviceState: relation.wellDeviceState,
        wellOnlineState: relation.wellOnlineState,
        dedicatedDeviceState: relation.pumpDeviceState,
        dedicatedOnlineState: relation.pumpOnlineState
      })
    ) {
      blockingReasons.push(
        createBlockingReason(
          ErrorCodes.DEVICE_OFFLINE,
          'pump control path is not active and online',
          'topology',
          {
            deviceRole: 'pump',
            lifecycleState: relation.pumpDeviceState,
            onlineState: relation.pumpOnlineState
          }
        )
      );
    }

    if (
      !isRoleControllable({
        role: 'valve',
        wellFeatureModules: relation.wellFeatureModules,
        wellDeviceState: relation.wellDeviceState,
        wellOnlineState: relation.wellOnlineState,
        dedicatedDeviceState: relation.valveDeviceState,
        dedicatedOnlineState: relation.valveOnlineState
      })
    ) {
      blockingReasons.push(
        createBlockingReason(
          ErrorCodes.DEVICE_OFFLINE,
          'valve control path is not active and online',
          'topology',
          {
            deviceRole: 'valve',
            lifecycleState: relation.valveDeviceState,
            onlineState: relation.valveOnlineState
          }
        )
      );
    }

    if (integratedWellController) {
      return {
        relation: {
          ...relation,
          relationConfigJson: {
            ...relation.relationConfigJson,
            integrated_controller_mode: 'well_device_local_control'
          }
        },
        blockingReasons
      };
    }

    return {
      relation,
      blockingReasons
    };
  }
}
