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
      task_type: 'ENGINEERING',
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
    expect(m.task_type).toBe('ENGINEERING');
    expect(m.summary).toEqual({ goal: 'g', steps: ['a'] });
    expect(m.payload_md_legacy).toBeUndefined();
    expect(m.artifact_ref).toBe('ref/1');
  });

  it('buildDispatchTaskReadModel exposes payload_md_legacy when no summary', () => {
    const row = {
      task_id: 'T2',
      team: 'cursor',
      task_type: 'LANGUAGE',
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
    expect(m.task_type).toBe('LANGUAGE');
    expect(m.summary).toBeNull();
    expect(m.payload_md_legacy).toContain('# Title');
  });

  it('buildDispatchTaskReadModel exposes sequencing fields when present on row', () => {
    const row = {
      task_id: 'T3',
      team: 'cursor',
      task_type: 'ENGINEERING',
      title: 't',
      mode: 'BACKEND',
      status: 'synced_ready',
      purpose: null,
      source_file: null,
      artifact_ref: null,
      summary_json: null,
      payload_md: null,
      next_task_id: 'COD-NEXT',
      depends_on_task_id: null,
      queue_order: 10,
      updated_at: new Date(),
      created_at: new Date()
    };
    const m = buildDispatchTaskReadModel(row as any);
    expect(m.task_type).toBe('ENGINEERING');
    expect(m.next_task_id).toBe('COD-NEXT');
    expect(m.depends_on_task_id).toBeNull();
    expect(m.queue_order).toBe(10);
  });
});
