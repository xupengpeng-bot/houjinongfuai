import {
  buildPumpValveTopologyRelationReadModel,
  PUMP_VALVE_TOPOLOGY_STATE
} from '../../src/modules/topology/pump-valve-topology-read-model';

describe('pump-valve-topology-read-model', () => {
  it('exposes storage location and keeps pump_valve separate from generic topology_relation', () => {
    const m = buildPumpValveTopologyRelationReadModel({
      manual: 'linkage',
      reported: 'control',
      effective: 'sequence_delayed'
    });
    expect(m.truthKind).toBe('pump_valve_relation_v1');
    expect(m.notMergedWith).toBe('topology_relation_device_edges');
    expect(m.storage).toEqual(PUMP_VALVE_TOPOLOGY_STATE);
    expect(m.layers.effective).toBe('sequence_delayed');
    expect(m.effectiveResolved).toBe('sequence_delayed');
  });
});
