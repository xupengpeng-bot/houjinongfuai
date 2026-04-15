import type { PoolClient } from 'pg';
import { OrderSettlementService } from '../../src/modules/order/order-settlement.service';

describe('OrderSettlementService formal lifecycle rules', () => {
  const db = {
    query: jest.fn(),
  };
  const farmerFundService = {
    settleLockedOrder: jest.fn(),
    getWalletState: jest.fn(),
  };
  const service = new OrderSettlementService(db as any, farmerFundService as any);
  const client = {} as PoolClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks stop timeout as stop_pending_review and preserves the frozen snapshot', async () => {
    jest.spyOn(service, 'freezeProgressAtStopRequest').mockResolvedValue({
      amount: 18.5,
      usage: {
        durationSec: 660,
        waterVolumeM3: 3.2,
        energyKwh: 1.1,
      },
      pricingDetail: {
        lifecycle_stage: 'stopping',
        stop_request_snapshot: {
          requested_at: '2026-04-11T10:00:00.000Z',
          amount: 18.5,
        },
      },
      context: {
        orderId: 'order-1',
      },
    } as any);

    const result = await service.markStopPendingReview('session-1', client, {
      reviewAt: '2026-04-11T10:05:00.000Z',
      reasonCode: 'ack_timeout_exceeded',
      reasonText: 'device stop ack timeout',
      source: 'timeout_sweeper',
      commandId: 'cmd-1',
      commandToken: 'token-1',
      commandCode: 'STOP_SESSION',
    });

    expect(result?.pricingDetail.lifecycle_stage).toBe('stop_pending_review');
    expect(result?.pricingDetail.stop_amount_frozen).toBe(true);
    expect(result?.pricingDetail.stop_pending_review).toBe(true);
    expect(result?.pricingDetail.stop_pending_review_snapshot).toEqual(
      expect.objectContaining({
        reason_code: 'ack_timeout_exceeded',
        command_id: 'cmd-1',
        command_token: 'token-1',
        command_code: 'STOP_SESSION',
        amount: 18.5,
        stop_request_snapshot: expect.objectContaining({
          requested_at: '2026-04-11T10:00:00.000Z',
        }),
      }),
    );

    expect(db.query).toHaveBeenCalledTimes(1);
    const [, params] = db.query.mock.calls[0];
    const persistedPricingDetail = JSON.parse(params[1]);
    expect(persistedPricingDetail.lifecycle_stage).toBe('stop_pending_review');
    expect(persistedPricingDetail.stop_amount_frozen_reason).toBe('awaiting_manual_stop_review');
  });

  it('marks pause confirmation as paused and keeps amount frozen', async () => {
    jest.spyOn(service as any, 'loadSessionOrderContext').mockResolvedValue({
      orderId: 'order-2',
      sessionId: 'session-2',
      pricingDetail: {
        lifecycle_stage: 'running',
        pause_summary: {
          state: 'pausing',
          current_segment: {
            pause_requested_at: '2026-04-11T11:00:00.000Z',
          },
        },
      },
    });

    const result = await service.markPauseConfirmed('session-2', client, {
      pausedAt: '2026-04-11T11:02:00.000Z',
      reasonCode: 'PAUSE_COMMAND_ACKED',
      source: 'device_ack',
    });

    expect(result?.pricingDetail.lifecycle_stage).toBe('paused');
    expect(result?.pricingDetail.pause_amount_frozen).toBe(true);
    expect(result?.pricingDetail.pause_amount_frozen_reason).toBe('device_pause_confirmed');
    expect(result?.pricingDetail.pause_summary).toEqual(
      expect.objectContaining({
        state: 'paused',
      }),
    );

    const [, params] = db.query.mock.calls[0];
    const persistedPricingDetail = JSON.parse(params[1]);
    expect(persistedPricingDetail.lifecycle_stage).toBe('paused');
  });

  it('marks resume confirmation as running and accumulates paused duration', async () => {
    jest.spyOn(service as any, 'loadSessionOrderContext').mockResolvedValue({
      orderId: 'order-3',
      sessionId: 'session-3',
      pricingDetail: {
        lifecycle_stage: 'paused',
        pause_summary: {
          state: 'resuming',
          total_paused_duration_sec: 120,
          current_segment: {
            pause_requested_at: '2026-04-11T12:00:00.000Z',
            pause_confirmed_at: '2026-04-11T12:01:00.000Z',
            resume_requested_at: '2026-04-11T12:04:00.000Z',
          },
        },
      },
    });

    const result = await service.markResumedFromPause('session-3', client, {
      resumedAt: '2026-04-11T12:06:00.000Z',
      reasonCode: 'RESUME_COMMAND_ACKED',
      source: 'device_ack',
    });

    expect(result?.pricingDetail.lifecycle_stage).toBe('running');
    expect(result?.pricingDetail.pause_amount_frozen).toBe(false);
    expect(result?.pricingDetail.pause_summary).toEqual(
      expect.objectContaining({
        state: 'running',
        total_paused_duration_sec: 420,
      }),
    );

    const [, params] = db.query.mock.calls[0];
    const persistedPricingDetail = JSON.parse(params[1]);
    expect(persistedPricingDetail.lifecycle_stage).toBe('running');
    expect(persistedPricingDetail.pause_summary.total_paused_duration_sec).toBe(420);
  });

  it('derives timed usage from cumulative runtime minus startup baseline', async () => {
    jest.spyOn(service as any, 'loadSessionOrderContext').mockResolvedValue({
      orderId: 'order-4',
      sessionId: 'session-4',
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionStatus: 'running',
      orderStatus: 'created',
      settlementStatus: 'unpaid',
      fundingMode: 'card_wallet_locked',
      paymentMode: 'card',
      paymentStatus: 'locked',
      prepaidAmount: 0,
      lockedAmount: 1,
      refundedAmount: 0,
      sourcePaymentIntentId: null,
      pricingProgressAt: null,
      pricingSnapshot: {
        mode: 'duration',
        unitPrice: 0.1,
        minChargeAmount: 0,
        unitType: 'minute',
        pricingRules: {},
      },
      pricingDetail: {
        metric_snapshot: {
          baseline: {
            runtimeSec: 1000,
            waterTotalM3: 0.289,
            energyKwh: 53,
          },
        },
      },
      checkoutSnapshot: {},
      startedAt: '2026-04-11T11:40:53.838Z',
      endedAt: null,
      pumpId: null,
      sessionRef: 'SIM-TEST-4',
      wellDeviceId: null,
      wellImei: null,
      pumpDeviceId: null,
      pumpImei: null,
      pumpRatedPowerKw: null,
      valveDeviceId: null,
      valveImei: null,
    });
    jest.spyOn(service as any, 'loadMetricSnapshot').mockResolvedValue({
      runtimeSec: 1054,
      waterTotalM3: 0.289,
      energyKwh: 53,
      pumpElectrical: {
        currentA: null,
        voltageV: null,
        powerKw: null,
        collectedAt: null,
        source: 'none',
        ratedPowerKw: null,
        concurrentSessionCount: 1,
      },
      pumpHealth: {
        status: 'unknown',
        scope: 'pump_dedicated',
        dataQuality: 'none',
        reasons: [],
        notes: [],
        currentA: null,
        voltageV: null,
        powerKw: null,
        ratedPowerKw: null,
        loadRate: null,
        concurrentSessionCount: 1,
        collectedAt: null,
      },
    });

    const result = await service.syncProgressBySessionId('session-4', {
      force: true,
      client,
      settledAt: '2026-04-11T11:41:47.358Z',
    });

    expect(result && 'skipped' in result).toBe(false);
    expect((result as any)?.usage.durationSec).toBe(54);
    expect((result as any)?.amount).toBe(0.09);

    const [, params] = db.query.mock.calls[0];
    expect(params[1]).toBe(54);
    expect(params[3]).toBe(0.09);
    expect(params[5]).toBe(false);
  });

  it('cancels start-failed locked orders even when wallet locked balance is already missing', async () => {
    jest.spyOn(service as any, 'loadSessionOrderContext').mockResolvedValue({
      orderId: 'order-5',
      sessionId: 'session-5',
      tenantId: 'tenant-1',
      userId: 'user-5',
      orderStatus: 'created',
      settlementStatus: 'unpaid',
      fundingMode: 'card_wallet_locked',
      paymentMode: 'card',
      paymentStatus: 'locked',
      prepaidAmount: 0,
      lockedAmount: 1.41,
      refundedAmount: 0,
      pricingSnapshot: {
        mode: 'duration',
      },
      pricingDetail: {
        lifecycle_stage: 'pending_start',
      },
      sourcePaymentIntentId: null,
    });
    farmerFundService.settleLockedOrder.mockRejectedValue({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      message: 'Wallet balance is insufficient for lock',
    });
    farmerFundService.getWalletState.mockResolvedValue({
      balance: 1.41,
      lockedBalance: 0,
    });

    const result = await service.cancelOrderBeforeStart('session-5', client, {
      settledAt: '2026-04-12T00:30:00.000Z',
      gatewayEventCode: 'sync_start_ack_timeout',
      failureSource: 'command_timeout',
      failureMessage: 'start command timed out',
    });

    expect(result).toEqual(
      expect.objectContaining({
        orderId: 'order-5',
        paymentStatus: 'refunded',
        refundedAmount: 1.41,
        settlementStatus: 'cancelled',
      }),
    );

    const [, params] = db.query.mock.calls[0];
    const persistedPricingSnapshot = JSON.parse(params[3]);
    const persistedPricingDetail = JSON.parse(params[4]);
    expect(persistedPricingDetail.manual_cleanup_wallet_unlock_skipped).toBe(true);
    expect(persistedPricingDetail.manual_cleanup_wallet_snapshot).toEqual(
      expect.objectContaining({
        balance: 1.41,
        locked_balance: 0,
        expected_locked_amount: 1.41,
      }),
    );
    expect(
      persistedPricingSnapshot.breakdown.find((item: { item: string }) => item.item === 'manual_cleanup_wallet_unlock_skipped')?.value,
    ).toBe(true);
  });
});
