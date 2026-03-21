import { Injectable } from '@nestjs/common';
import { BlockingReason, createBlockingReason } from '../../common/contracts/runtime-decision';
import { ErrorCodes } from '../../common/errors/error-codes';
import { RelationValidationResult } from './topology.dto';
import { TopologyRepository } from './topology.repository';

@Injectable()
export class TopologyService {
  constructor(private readonly topologyRepository: TopologyRepository) {}

  async validateStartTarget(targetType: 'valve' | 'well' | 'session', targetId: string): Promise<RelationValidationResult> {
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

    const relation = targetType === 'valve'
      ? await this.topologyRepository.findRelationByValveId(targetId)
      : await this.topologyRepository.findPrimaryRelationByWellId(targetId);

    if (!relation) {
      return {
        relation: null,
        blockingReasons: [
          createBlockingReason(
            ErrorCodes.RELATION_NOT_CONFIGURED,
            'No active pump-valve relation was found for the target',
            'topology'
          )
        ]
      };
    }

    const blockingReasons: BlockingReason[] = [];
    if (relation.relationRole === 'forbidden') {
      blockingReasons.push(
        createBlockingReason(ErrorCodes.RELATION_FORBIDDEN, 'The relation is marked as forbidden', 'topology')
      );
    }

    const stateChecks = [
      ['well', relation.wellDeviceState, relation.wellOnlineState],
      ['pump', relation.pumpDeviceState, relation.pumpOnlineState],
      ['valve', relation.valveDeviceState, relation.valveOnlineState]
    ] as const;

    for (const [label, lifecycleState, onlineState] of stateChecks) {
      if (lifecycleState !== 'active' || onlineState !== 'online') {
        blockingReasons.push(
          createBlockingReason(
            ErrorCodes.DEVICE_OFFLINE,
            `${label} device is not active and online`,
            'topology',
            {
              deviceRole: label,
              lifecycleState,
              onlineState
            }
          )
        );
      }
    }

    return {
      relation,
      blockingReasons
    };
  }
}
