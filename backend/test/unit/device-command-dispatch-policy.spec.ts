import {
  resolveExecuteActionDispatchPolicy,
  resolveQueryDispatchPolicy,
  resolveSyncConfigDispatchPolicy,
} from '../../src/modules/device-gateway/device-command-dispatch-policy';

describe('device command dispatch policy', () => {
  it('marks short physical control actions as must-sync and non-replayable', () => {
    const policy = resolveExecuteActionDispatchPolicy('spu');

    expect(policy.code).toBe('start_pump');
    expect(policy.dispatchClass).toBe('must_sync');
    expect(policy.defaultDispatchMode).toBe('sync');
    expect(policy.allowAsync).toBe(false);
    expect(policy.replayPolicy).toBe('never_replay');
  });

  it('treats firmware upgrade as must-sync handoff but retryable for ack reconciliation', () => {
    const policy = resolveExecuteActionDispatchPolicy('upg');

    expect(policy.code).toBe('upgrade_firmware');
    expect(policy.dispatchClass).toBe('must_sync');
    expect(policy.defaultDispatchMode).toBe('sync');
    expect(policy.allowAsync).toBe(false);
    expect(policy.replayPolicy).toBe('allow_retry');
  });

  it('treats ota actions as must-sync handoff and non-replayable', () => {
    const policy = resolveExecuteActionDispatchPolicy('ota_start');

    expect(policy.dispatchClass).toBe('must_sync');
    expect(policy.defaultDispatchMode).toBe('sync');
    expect(policy.allowAsync).toBe(false);
    expect(policy.replayPolicy).toBe('never_replay');
  });

  it('keeps voice prompt as async-friendly action', () => {
    const policy = resolveExecuteActionDispatchPolicy('ppu');

    expect(policy.code).toBe('play_voice_prompt');
    expect(policy.dispatchClass).toBe('prefer_async');
    expect(policy.defaultDispatchMode).toBe('async');
    expect(policy.allowAsync).toBe(true);
    expect(policy.replayPolicy).toBe('allow_retry');
  });

  it('defaults electric-meter query to async but leaves workflow/common state sync-first', () => {
    expect(resolveQueryDispatchPolicy('qcs').defaultDispatchMode).toBe('sync');
    expect(resolveQueryDispatchPolicy('qwf').defaultDispatchMode).toBe('sync');
    expect(resolveQueryDispatchPolicy('qem').defaultDispatchMode).toBe('async');
    expect(resolveQueryDispatchPolicy('query_upgrade_status').defaultDispatchMode).toBe('sync');
  });

  it('keeps sync-config async by default', () => {
    const policy = resolveSyncConfigDispatchPolicy();

    expect(policy.defaultDispatchMode).toBe('async');
    expect(policy.allowAsync).toBe(true);
    expect(policy.replayPolicy).toBe('allow_retry');
  });
});
