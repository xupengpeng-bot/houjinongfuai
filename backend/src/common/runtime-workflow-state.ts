const COMPACT_WORKFLOW_STATE_MAP: Record<string, string> = {
  BR: 'BOOTING',
  NR: 'ONLINE_NOT_READY',
  RI: 'READY_IDLE',
  ST: 'STARTING',
  RN: 'RUNNING',
  PA: 'PAUSING',
  PS: 'PAUSED',
  RS: 'RESUMING',
  SP: 'STOPPING',
  ED: 'STOPPED',
  ER: 'ERROR_STOP',
};

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRuntimeWorkflowState(value: unknown) {
  const normalized = asString(value);
  if (!normalized) return null;
  const upper = normalized.toUpperCase().replace(/[\s-]+/g, '_');
  return COMPACT_WORKFLOW_STATE_MAP[upper] ?? upper;
}

export function isActiveRuntimeWorkflowState(value: unknown) {
  const normalized = normalizeRuntimeWorkflowState(value);
  return normalized !== null && ['STARTING', 'RUNNING', 'BILLING', 'ACTIVE', 'RESUMING'].includes(normalized);
}

export function isPausedRuntimeWorkflowState(value: unknown) {
  return normalizeRuntimeWorkflowState(value) === 'PAUSED';
}

export function isIdleRuntimeWorkflowState(value: unknown) {
  const normalized = normalizeRuntimeWorkflowState(value);
  return normalized !== null && ['READY', 'READY_IDLE', 'STOPPED', 'IDLE'].includes(normalized);
}
