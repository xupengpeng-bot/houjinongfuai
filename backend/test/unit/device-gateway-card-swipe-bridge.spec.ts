import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';
import { OrderRepository } from '../../src/modules/order/order.repository';
import { OrderSettlementService } from '../../src/modules/order/order-settlement.service';
import { TcpJsonV1Adapter } from '../../src/modules/protocol-adapter/tcp-json-v1.adapter';
import { RuntimeCheckoutService } from '../../src/modules/runtime/runtime-checkout.service';
import { SessionStatusLogRepository } from '../../src/modules/runtime/session-status-log.repository';
import { RuntimeIngestService } from '../../src/modules/runtime-ingest/runtime-ingest.service';

describe('DeviceGatewayService card swipe bridge compatibility', () => {
  const adapter = new TcpJsonV1Adapter();

  let db: { query: jest.Mock };
  let checkoutService: { handleCardSwipe: jest.Mock };
  let service: DeviceGatewayService;

  beforeEach(() => {
    db = {
      query: jest.fn(),
    };
    checkoutService = {
      handleCardSwipe: jest.fn(),
    };

    service = new DeviceGatewayService(
      db as unknown as DatabaseService,
      { get: jest.fn() } as unknown as ConfigService,
      adapter,
      {} as OrderRepository,
      {} as OrderSettlementService,
      {} as SessionStatusLogRepository,
      {} as RuntimeIngestService,
      {
        get: jest.fn((token: unknown) => (token === RuntimeCheckoutService ? checkoutService : null)),
      } as unknown as ModuleRef,
    );

    jest.spyOn(service as any, 'upsertCardSwipeJournal').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'queueSwipeFeedbackPrompt').mockResolvedValue(null);
  });

  it('recognizes accepted platform checkout cse audits as swipe requests', () => {
    const event = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-CSE-REQ-0001',
      seqNo: 41,
      msgType: 'EVENT_REPORT',
      deviceTs: '2026-04-15T01:00:00Z',
      serverRxTs: '2026-04-15T01:00:01Z',
      payload: {
        ec: 'cse',
        rc: 'platform_checkout',
        tr: 'card',
        msg: 'accepted|uart1_card_reader|552928',
      },
    });

    expect((service as any).isCardSwipeRequestedEvent(event)).toBe(true);
  });

  it('resolves an active card token from cse suffix before bridging checkout', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ cardToken: '2602552928' }],
    });
    checkoutService.handleCardSwipe.mockResolvedValue({
      action: 'start',
      session_id: 'session-1',
      session_ref: 'SIM-1',
      order_id: 'order-1',
      awaiting_device_ack: false,
      queued_commands: [],
    });

    const event = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-CSE-REQ-0002',
      seqNo: 42,
      msgType: 'EVENT_REPORT',
      deviceTs: '2026-04-15T01:05:00Z',
      serverRxTs: '2026-04-15T01:05:01Z',
      payload: {
        ec: 'cse',
        rc: 'platform_checkout',
        tr: 'card',
        msg: 'accepted|uart1_card_reader|552928',
      },
    });

    const result = await (service as any).bridgeCardSwipeRequestedEvent(event, {} as any);

    expect(checkoutService.handleCardSwipe).toHaveBeenCalledWith(
      '860000000000001',
      '2602552928',
      null,
      'MSG-CSE-REQ-0002',
      '2026-04-15T01:05:00.000Z',
    );
    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        accepted: true,
        action: 'start',
        orderId: 'order-1',
      }),
    );
  });

  it('rejects cse swipe checkout when suffix matches multiple active cards', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ cardToken: '2602552928' }, { cardToken: '9900552928' }],
    });

    const event = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-CSE-REQ-0003',
      seqNo: 43,
      msgType: 'EVENT_REPORT',
      deviceTs: '2026-04-15T01:06:00Z',
      serverRxTs: '2026-04-15T01:06:01Z',
      payload: {
        ec: 'cse',
        rc: 'platform_checkout',
        tr: 'card',
        msg: 'accepted|uart1_card_reader|552928',
      },
    });

    const result = await (service as any).bridgeCardSwipeRequestedEvent(event, {} as any);

    expect(checkoutService.handleCardSwipe).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        accepted: false,
        promptCode: 'invalid_card',
      }),
    );
    expect(result.errorMessage).toContain('multiple active cards');
  });
});
