export type DeviceCommandDispatchMode = 'sync' | 'async';

export type DeviceCommandDispatchClass = 'must_sync' | 'prefer_sync' | 'prefer_async';

export type DeviceCommandReplayPolicy = 'never_replay' | 'allow_retry';

export type DeviceCommandDispatchPolicy = {
  target: 'query' | 'action' | 'config';
  code: string;
  dispatchClass: DeviceCommandDispatchClass;
  defaultDispatchMode: DeviceCommandDispatchMode;
  allowAsync: boolean;
  replayPolicy: DeviceCommandReplayPolicy;
  reason: string;
};

function normalizeCode(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeQueryCode(value: string | null | undefined) {
  const code = normalizeCode(value);
  if (code === 'qcs') return 'query_common_status';
  if (code === 'qwf') return 'query_workflow_state';
  if (code === 'qem') return 'query_electric_meter';
  return code;
}

function normalizeActionCode(value: string | null | undefined) {
  const code = normalizeCode(value);
  if (code === 'ppu') return 'play_voice_prompt';
  if (code === 'pas') return 'pause_session';
  if (code === 'res') return 'resume_session';
  if (code === 'upg') return 'upgrade_firmware';
  if (code === 'spu') return 'start_pump';
  if (code === 'tpu') return 'stop_pump';
  if (code === 'orl') return 'open_relay';
  if (code === 'crl') return 'close_relay';
  if (code === 'ovl') return 'open_valve';
  if (code === 'cvl') return 'close_valve';
  return code;
}

export function resolveQueryDispatchPolicy(queryCode: string | null | undefined): DeviceCommandDispatchPolicy {
  const code = normalizeQueryCode(queryCode);

  switch (code) {
    case 'query_common_status':
      return {
        target: 'query',
        code,
        dispatchClass: 'prefer_sync',
        defaultDispatchMode: 'sync',
        allowAsync: true,
        replayPolicy: 'allow_retry',
        reason: 'Common-status queries are sync-first for live pages and device checks.'
      };
    case 'query_workflow_state':
      return {
        target: 'query',
        code,
        dispatchClass: 'prefer_sync',
        defaultDispatchMode: 'sync',
        allowAsync: true,
        replayPolicy: 'allow_retry',
        reason: 'Workflow-state queries are sync-first because they affect runtime decisions.'
      };
    case 'query_electric_meter':
      return {
        target: 'query',
        code,
        dispatchClass: 'prefer_async',
        defaultDispatchMode: 'async',
        allowAsync: true,
        replayPolicy: 'allow_retry',
        reason: 'Electric-meter snapshots are async-first to avoid blocking live controls.'
      };
    case 'query_upgrade_status':
    case 'query_upgrade_capability':
      return {
        target: 'query',
        code,
        dispatchClass: 'prefer_sync',
        defaultDispatchMode: 'sync',
        allowAsync: true,
        replayPolicy: 'allow_retry',
        reason: 'OTA capability and progress checks are sync-first for upgrade validation.'
      };
    default:
      return {
        target: 'query',
        code,
        dispatchClass: 'prefer_async',
        defaultDispatchMode: 'async',
        allowAsync: true,
        replayPolicy: 'allow_retry',
        reason: 'Unknown queries default to async read-only handling.'
      };
  }
}

export function resolveExecuteActionDispatchPolicy(actionCode: string | null | undefined): DeviceCommandDispatchPolicy {
  const code = normalizeActionCode(actionCode);

  switch (code) {
    case 'start_pump':
    case 'stop_pump':
    case 'open_relay':
    case 'close_relay':
    case 'open_valve':
    case 'close_valve':
    case 'pause_session':
    case 'resume_session':
    case 'ota_prepare':
    case 'ota_start':
    case 'ota_cancel':
    case 'ota_commit':
    case 'ota_rollback':
      return {
        target: 'action',
        code,
        dispatchClass: 'must_sync',
        defaultDispatchMode: 'sync',
        allowAsync: false,
        replayPolicy: 'never_replay',
        reason: 'These actions change live device behavior and must be confirmed immediately.'
      };
    case 'upgrade_firmware':
      return {
        target: 'action',
        code,
        dispatchClass: 'must_sync',
        defaultDispatchMode: 'sync',
        allowAsync: false,
        replayPolicy: 'allow_retry',
        reason: 'Firmware upgrade must be dispatched immediately, but timeout recovery should reuse the same business command for idempotent ACK reconciliation.'
      };
    case 'play_voice_prompt':
      return {
        target: 'action',
        code,
        dispatchClass: 'prefer_async',
        defaultDispatchMode: 'async',
        allowAsync: true,
        replayPolicy: 'allow_retry',
        reason: 'Voice prompts are non-billing side effects and can queue asynchronously.'
      };
    default:
      return {
        target: 'action',
        code,
        dispatchClass: 'prefer_sync',
        defaultDispatchMode: 'sync',
        allowAsync: true,
        replayPolicy: 'allow_retry',
        reason: 'Unknown actions default to sync-first handling with optional async override.'
      };
  }
}

export function resolveSyncConfigDispatchPolicy(): DeviceCommandDispatchPolicy {
  return {
    target: 'config',
    code: 'sync_config',
    dispatchClass: 'prefer_async',
    defaultDispatchMode: 'async',
    allowAsync: true,
    replayPolicy: 'allow_retry',
    reason: 'Config sync is async-first and relies on versioned idempotency.'
  };
}

export function isNonReplayableRealtimeActionCode(actionCode: string | null | undefined) {
  return resolveExecuteActionDispatchPolicy(actionCode).replayPolicy === 'never_replay';
}
