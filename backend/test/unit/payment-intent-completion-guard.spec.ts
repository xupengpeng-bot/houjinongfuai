import { resolvePaymentIntentCompletionGuard } from '../../src/modules/runtime/payment-intent-completion-guard';

describe('payment intent completion guard', () => {
  it('treats refunded payment intents as terminal', () => {
    expect(
      resolvePaymentIntentCompletionGuard({
        status: 'refunded',
        sessionId: null,
        orderId: 'order-1',
      }),
    ).toEqual({
      mode: 'idempotent',
      paymentStatus: 'refunded',
    });
  });

  it('treats paid payment intents with linked runtime objects as idempotent', () => {
    expect(
      resolvePaymentIntentCompletionGuard({
        status: 'paid',
        sessionId: 'session-1',
        orderId: 'order-1',
      }),
    ).toEqual({
      mode: 'idempotent',
      paymentStatus: 'paid',
    });
  });

  it('allows incomplete payment intents to continue processing', () => {
    expect(
      resolvePaymentIntentCompletionGuard({
        status: 'created',
        sessionId: null,
        orderId: null,
      }),
    ).toEqual({
      mode: 'continue',
    });
  });
});
