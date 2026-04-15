export type FormalOrderLifecycleStage =
  | 'draft'
  | 'pending_start'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stop_pending_review'
  | 'ended'
  | 'settled';

export function normalizeFormalOrderLifecycleStage(value: unknown): FormalOrderLifecycleStage | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'draft') return 'draft';
  if (['pending_start', 'waiting_start', 'paid_waiting_start', 'locked_waiting_start'].includes(normalized)) {
    return 'pending_start';
  }
  if (['running', 'running_paid', 'running_locked', 'billing', 'pausing'].includes(normalized)) {
    return 'running';
  }
  if (normalized === 'paused' || normalized === 'resuming') return 'paused';
  if (normalized === 'stopping' || normalized === 'stopping_settling') return 'stopping';
  if (normalized === 'stop_pending_review') return 'stop_pending_review';
  if (normalized === 'ended') return 'ended';
  if (['settled', 'refunded', 'start_failed', 'start_failed_refunded'].includes(normalized)) {
    return 'settled';
  }

  return null;
}

export function deriveFormalOrderLifecycleStage(input: {
  explicitLifecycle?: unknown;
  orderStatus?: unknown;
  sessionStatus?: unknown;
  pricingDetail?: Record<string, unknown> | null;
}): FormalOrderLifecycleStage {
  const explicit = normalizeFormalOrderLifecycleStage(input.explicitLifecycle);
  if (explicit) return explicit;

  const pricingDetail = input.pricingDetail ?? {};
  if (pricingDetail.stop_pending_review === true || pricingDetail.stop_pending_review_at) {
    return 'stop_pending_review';
  }

  const orderStatus = String(input.orderStatus ?? '').trim().toLowerCase();
  if (orderStatus === 'settled') {
    return 'settled';
  }

  const sessionStatus = String(input.sessionStatus ?? '').trim().toLowerCase();
  if (sessionStatus === 'pending_start') return 'pending_start';
  if (sessionStatus === 'paused') return 'paused';
  if (sessionStatus === 'stopping') return 'stopping';
  if (sessionStatus === 'ended') return 'ended';
  if (['running', 'billing', 'pausing'].includes(sessionStatus)) return 'running';
  if (sessionStatus === 'resuming') return 'paused';

  if (orderStatus === 'created') return 'draft';
  return 'running';
}
