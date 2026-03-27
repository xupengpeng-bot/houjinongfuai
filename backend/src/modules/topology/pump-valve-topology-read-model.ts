import {
  resolveEffectiveTopologyRelationTypeV1,
  TOPOLOGY_RELATION_TYPE_V1_SET,
  type TopologyRelationTypeV1
} from './topology-relation-type-v1';

/**
 * Explicit boundary: **PumpValveRelation** (well–pump–valve business rows) is the V1 strong
 * relation for irrigation topology typing. **TopologyRelation** (`topology_relation` table,
 * device↔device) is the generic extension — do not merge these into one truth model.
 */
export const PUMP_VALVE_TOPOLOGY_STATE = {
  table: 'pump_valve_relation',
  column: 'topology_relation_type_state',
  encoding: 'jsonb' as const,
  /** Keys inside JSON; all layers are persisted in this single column. */
  layerKeys: ['manual', 'reported', 'effective'] as const
};

export interface PumpValveTopologyRelationReadModel {
  truthKind: 'pump_valve_relation_v1';
  /** Same vocabulary as `DeviceRelationsService.relationTypeOptions` values; not `topology_relation` rows. */
  notMergedWith: 'topology_relation_device_edges';
  storage: typeof PUMP_VALVE_TOPOLOGY_STATE;
  layers: {
    manual: TopologyRelationTypeV1 | null;
    reported: TopologyRelationTypeV1 | null;
    effective: TopologyRelationTypeV1 | null;
  };
  /** Canonical for solver-facing pump-valve context. */
  effectiveResolved: TopologyRelationTypeV1;
  resolutionOrder: readonly string[];
}

const RESOLUTION_ORDER = ['effective', 'manual', 'reported', 'default:sequence_delayed'] as const;

function pickLayer(raw: Record<string, unknown>, key: string): TopologyRelationTypeV1 | null {
  const v = raw[key];
  return typeof v === 'string' && TOPOLOGY_RELATION_TYPE_V1_SET.has(v)
    ? (v as TopologyRelationTypeV1)
    : null;
}

export function buildPumpValveTopologyRelationReadModel(
  topologyRelationTypeState: Record<string, unknown> | null | undefined
): PumpValveTopologyRelationReadModel {
  const raw = topologyRelationTypeState ?? {};
  const layers = {
    manual: pickLayer(raw, 'manual'),
    reported: pickLayer(raw, 'reported'),
    effective: pickLayer(raw, 'effective')
  };
  const effectiveResolved = resolveEffectiveTopologyRelationTypeV1(raw);
  return {
    truthKind: 'pump_valve_relation_v1',
    notMergedWith: 'topology_relation_device_edges',
    storage: PUMP_VALVE_TOPOLOGY_STATE,
    layers: {
      manual: layers.manual ?? null,
      reported: layers.reported ?? null,
      effective: layers.effective ?? null
    },
    effectiveResolved,
    resolutionOrder: [...RESOLUTION_ORDER]
  };
}
