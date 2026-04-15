import { resolveRuntimeShadowWorkflowState } from '../../src/modules/runtime-ingest/runtime-shadow-state';

describe('runtime shadow state', () => {
  it('prefers explicit workflow state from payload', () => {
    expect(
      resolveRuntimeShadowWorkflowState({
        payload: {
          workflow_state: 'RUNNING',
          event_code: 'ss',
        },
        controllerState: {},
      }),
    ).toBe('RUNNING');
  });

  it('falls back to controller state workflow when payload omits it', () => {
    expect(
      resolveRuntimeShadowWorkflowState({
        payload: {
          event_code: 'platform_stop',
        },
        controllerState: {
          workflow_state: 'READY_IDLE',
        },
      }),
    ).toBe('READY_IDLE');
  });

  it('does not treat event codes as workflow state', () => {
    expect(
      resolveRuntimeShadowWorkflowState({
        payload: {
          event_code: 'ss',
          reason_code: 'platform_stop',
        },
        controllerState: {},
      }),
    ).toBeNull();
  });
});
