import { DeviceRelationsService } from '../../src/modules/device-relations/device-relations.service';
import { DeviceRelationsRepository } from '../../src/modules/device-relations/device-relations.repository';

describe('DeviceRelationsService', () => {
  it('relationTypeOptions returns six frozen types with Chinese labels', () => {
    const repo = {} as DeviceRelationsRepository;
    const svc = new DeviceRelationsService(repo);
    const opts = svc.relationTypeOptions();
    expect(opts).toHaveLength(6);
    expect(opts.map((o) => o.value)).toContain('sequence_delayed');
    expect(opts.find((o) => o.value === 'control')?.label).toBe('控制');
  });

  it('sequenceRuleOptions returns three canonical rules', () => {
    const repo = {} as DeviceRelationsRepository;
    const svc = new DeviceRelationsService(repo);
    const opts = svc.sequenceRuleOptions();
    expect(opts).toHaveLength(3);
    expect(opts.map((o) => o.value)).toEqual(
      expect.arrayContaining(['source_first', 'target_first', 'simultaneous'])
    );
  });
});
