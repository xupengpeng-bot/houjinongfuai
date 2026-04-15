export type PaymentIntentCompletionGuardResult =
  | {
      mode: 'continue';
    }
  | {
      mode: 'idempotent';
      paymentStatus: 'paid' | 'refunded';
    };

export function resolvePaymentIntentCompletionGuard(input: {
  status?: string | null;
  sessionId?: string | null;
  orderId?: string | null;
}): PaymentIntentCompletionGuardResult {
  const normalizedStatus = String(input.status ?? '')
    .trim()
    .toLowerCase();

  if (normalizedStatus === 'refunded') {
    return {
      mode: 'idempotent',
      paymentStatus: 'refunded',
    };
  }

  if (normalizedStatus === 'paid' && (input.sessionId || input.orderId)) {
    return {
      mode: 'idempotent',
      paymentStatus: 'paid',
    };
  }

  return {
    mode: 'continue',
  };
}
