import {
  deriveFormalOrderLifecycleStage,
  normalizeFormalOrderLifecycleStage,
} from '../../src/modules/order/order-lifecycle';

describe('order-lifecycle formal mapping', () => {
  it('normalizes legacy lifecycle values into formal stages', () => {
    expect(normalizeFormalOrderLifecycleStage('running_paid')).toBe('running');
    expect(normalizeFormalOrderLifecycleStage('locked_waiting_start')).toBe('pending_start');
    expect(normalizeFormalOrderLifecycleStage('stopping_settling')).toBe('stopping');
    expect(normalizeFormalOrderLifecycleStage('start_failed_refunded')).toBe('settled');
  });

  it('prefers stop_pending_review marker over session guesses', () => {
    expect(
      deriveFormalOrderLifecycleStage({
        orderStatus: 'active',
        sessionStatus: 'running',
        pricingDetail: {
          stop_pending_review: true,
        },
      }),
    ).toBe('stop_pending_review');
  });

  it('treats resuming as paused until resume is actually confirmed', () => {
    expect(
      deriveFormalOrderLifecycleStage({
        orderStatus: 'active',
        sessionStatus: 'resuming',
        pricingDetail: {},
      }),
    ).toBe('paused');
  });
});
