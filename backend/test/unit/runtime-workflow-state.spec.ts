import {
  isActiveRuntimeWorkflowState,
  isIdleRuntimeWorkflowState,
  isPausedRuntimeWorkflowState,
  normalizeRuntimeWorkflowState,
} from '../../src/common/runtime-workflow-state';

describe('runtime workflow state helpers', () => {
  it('normalizes compact workflow state codes', () => {
    expect(normalizeRuntimeWorkflowState('RN')).toBe('RUNNING');
    expect(normalizeRuntimeWorkflowState('ri')).toBe('READY_IDLE');
    expect(normalizeRuntimeWorkflowState('paused')).toBe('PAUSED');
  });

  it('detects active workflow states from compact and verbose forms', () => {
    expect(isActiveRuntimeWorkflowState('RN')).toBe(true);
    expect(isActiveRuntimeWorkflowState('running')).toBe(true);
    expect(isActiveRuntimeWorkflowState('READY_IDLE')).toBe(false);
  });

  it('detects paused and idle workflow states', () => {
    expect(isPausedRuntimeWorkflowState('PS')).toBe(true);
    expect(isIdleRuntimeWorkflowState('RI')).toBe(true);
    expect(isIdleRuntimeWorkflowState('ED')).toBe(true);
    expect(isIdleRuntimeWorkflowState('RN')).toBe(false);
  });
});
