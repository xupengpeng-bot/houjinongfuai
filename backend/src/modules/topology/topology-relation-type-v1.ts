/**
 * Aligns with `DeviceRelationsService.relationTypeOptions()` — Phase-1 frozen V1 enum.
 * Solver and pump-valve rows use the same vocabulary for `topology_relation_type_state.effective`.
 */
export const TOPOLOGY_RELATION_TYPE_V1 = [
  'control',
  'linkage',
  'interlock',
  'master_slave',
  'gateway_access',
  'sequence_delayed'
] as const;

export type TopologyRelationTypeV1 = (typeof TOPOLOGY_RELATION_TYPE_V1)[number];

export const TOPOLOGY_RELATION_TYPE_V1_SET = new Set<string>(TOPOLOGY_RELATION_TYPE_V1);

/** Default when no valid layer is set — matches pump-valve sequencing semantics. */
export const TOPOLOGY_RELATION_TYPE_V1_DEFAULT: TopologyRelationTypeV1 = 'sequence_delayed';

export interface TopologyRelationTypeStateV1 {
  manual?: TopologyRelationTypeV1 | null;
  reported?: TopologyRelationTypeV1 | null;
  /** Canonical for solver; if absent, {@link resolveEffectiveTopologyRelationTypeV1} derives it. */
  effective?: TopologyRelationTypeV1 | null;
}

export function resolveEffectiveTopologyRelationTypeV1(
  state: Record<string, unknown> | null | undefined
): TopologyRelationTypeV1 {
  const s = state ?? {};
  const pick = (key: string): TopologyRelationTypeV1 | null => {
    const v = s[key];
    return typeof v === 'string' && TOPOLOGY_RELATION_TYPE_V1_SET.has(v)
      ? (v as TopologyRelationTypeV1)
      : null;
  };
  return pick('effective') ?? pick('manual') ?? pick('reported') ?? TOPOLOGY_RELATION_TYPE_V1_DEFAULT;
}
