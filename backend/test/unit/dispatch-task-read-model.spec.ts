import {
  buildDispatchTaskReadModel,
  parseSummaryJson
} from '../../src/modules/dispatch-mysql/dispatch-task-read-model';

describe('dispatch-task-read-model', () => {
  it('parseSummaryJson handles object from mysql2 JSON column', () => {
    expect(parseSummaryJson({ a: 1 })).toEqual({ a: 1 });
  });

  it('buildDispatchTaskReadModel prefers summary and omits legacy when summary present', () => {
    const row = {
      task_id: 'T1',
      team: 'cursor',
      title: 't',
      mode: 'BACKEND',
      status: 'active',
      purpose: 'p',
      source_file: 'db://x',
      artifact_ref: 'ref/1',
      summary_json: { goal: 'g', steps: ['a'] },
      payload_md: '# huge markdown',
      updated_at: new Date(),
      created_at: new Date()
    };
    const m = buildDispatchTaskReadModel(row as any);
    expect(m.summary).toEqual({ goal: 'g', steps: ['a'] });
    expect(m.payload_md_legacy).toBeUndefined();
    expect(m.artifact_ref).toBe('ref/1');
  });

  it('buildDispatchTaskReadModel exposes payload_md_legacy when no summary', () => {
    const row = {
      task_id: 'T2',
      team: 'cursor',
      title: 't',
      mode: 'VERIFY',
      status: 'active',
      purpose: 'p',
      source_file: null,
      artifact_ref: null,
      summary_json: null,
      payload_md: '# Title\nbody',
      updated_at: new Date(),
      created_at: new Date()
    };
    const m = buildDispatchTaskReadModel(row as any);
    expect(m.summary).toBeNull();
    expect(m.payload_md_legacy).toContain('# Title');
  });
});
