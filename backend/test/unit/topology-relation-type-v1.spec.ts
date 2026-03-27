import {
  resolveEffectiveTopologyRelationTypeV1,
  TOPOLOGY_RELATION_TYPE_V1_DEFAULT
} from '../../src/modules/topology/topology-relation-type-v1';

describe('topology-relation-type-v1', () => {
  it('resolveEffective prefers effective over manual/reported', () => {
    expect(
      resolveEffectiveTopologyRelationTypeV1({
        effective: 'control',
        manual: 'linkage',
        reported: 'interlock'
      })
    ).toBe('control');
  });

  it('resolveEffective falls back manual then reported then default', () => {
    expect(resolveEffectiveTopologyRelationTypeV1({ manual: 'linkage' })).toBe('linkage');
    expect(resolveEffectiveTopologyRelationTypeV1({ reported: 'gateway_access' })).toBe(
      'gateway_access'
    );
    expect(resolveEffectiveTopologyRelationTypeV1({})).toBe(TOPOLOGY_RELATION_TYPE_V1_DEFAULT);
  });
});
