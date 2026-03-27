import { mergeProjectBlockScope } from '../../src/modules/policy/data-scope.resolve';

describe('mergeProjectBlockScope (COD-2026-03-27-020)', () => {
  const projects = [
    { id: 'p1', project_code: 'P1', project_name: 'One', status: 'active' },
    { id: 'p2', project_code: 'P2', project_name: 'Two', status: 'active' }
  ];
  const blocks = [
    { id: 'b1', project_id: 'p1', block_code: 'B1', block_name: 'North', status: 'active' },
    { id: 'b2', project_id: 'p1', block_code: 'B2', block_name: 'South', status: 'active' },
    { id: 'b3', project_id: 'p2', block_code: 'B3', block_name: 'East', status: 'active' }
  ];

  it('project allow exposes all blocks under that project', () => {
    const policies = [
      {
        id: '1',
        scope_type: 'project' as const,
        project_id: 'p1',
        block_id: null,
        effect: 'allow'
      }
    ];
    const m = mergeProjectBlockScope(policies, projects, blocks);
    expect(m.visibleProjectIds).toEqual(['p1']);
    expect(new Set(m.visibleBlockIds)).toEqual(new Set(['b1', 'b2']));
  });

  it('block allow exposes only that block but lists its project', () => {
    const policies = [
      {
        id: '1',
        scope_type: 'block' as const,
        project_id: 'p2',
        block_id: 'b3',
        effect: 'allow'
      }
    ];
    const m = mergeProjectBlockScope(policies, projects, blocks);
    expect(m.visibleProjectIds).toEqual(['p2']);
    expect(m.visibleBlockIds).toEqual(['b3']);
  });

  it('ignores non-allow effects', () => {
    const policies = [
      {
        id: '1',
        scope_type: 'project' as const,
        project_id: 'p1',
        block_id: null,
        effect: 'deny'
      }
    ];
    const m = mergeProjectBlockScope(policies, projects, blocks);
    expect(m.visibleProjectIds).toEqual([]);
    expect(m.visibleBlockIds).toEqual([]);
  });
});
