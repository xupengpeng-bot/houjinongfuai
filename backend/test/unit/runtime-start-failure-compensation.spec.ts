import { RuntimeService } from '../../src/modules/runtime/runtime.service';

describe('runtime start failure compensation', () => {
  it('queues compensation stop commands after a timed-out start may have partially executed', async () => {
    const queueCommand = jest
      .fn()
      .mockResolvedValueOnce({
        command: {
          id: 'stop-valve-id',
          command_token: 'stop-valve-token',
          command_code: 'CLOSE_VALVE',
          command_status: 'created',
          imei: 'valve-imei',
          session_id: 'session-1',
          session_ref: 'SIM-1',
          start_token: 'stop-session-1',
        },
      })
      .mockResolvedValueOnce({
        command: {
          id: 'stop-pump-id',
          command_token: 'stop-pump-token',
          command_code: 'STOP_PUMP',
          command_status: 'created',
          imei: 'well-imei',
          session_id: 'session-1',
          session_ref: 'SIM-1',
          start_token: 'stop-session-1',
        },
      });
    const dispatchQueuedCommandNow = jest.fn().mockResolvedValue({
      attempted: true,
      delivered: true,
      mode: 'realtime_socket',
      reason: 'delivered_now',
      command_status: 'sent',
    });
    const sessionStatusLogCreate = jest.fn().mockResolvedValue(undefined);

    const service = new RuntimeService(
      {} as any,
      {
        findSessionControlTargets: jest.fn().mockResolvedValue({
          wellFeatureModules: ['breaker_control'],
          wellDeviceState: 'active',
          wellOnlineState: 'online',
          wellDeviceId: 'well-device',
          wellImei: 'well-imei',
          pumpDeviceState: 'archived',
          pumpOnlineState: 'offline',
          pumpDeviceId: 'pump-device',
          pumpImei: 'pump-imei',
          valveDeviceState: 'active',
          valveOnlineState: 'online',
          valveDeviceId: 'valve-device',
          valveImei: 'valve-imei',
        }),
      } as any,
      {} as any,
      { create: sessionStatusLogCreate } as any,
      { queueCommand } as any,
      { dispatchQueuedCommandNow } as any,
      {} as any,
      {
        findRuntimeShadowByImei: jest.fn(),
        listChannelLatest: jest.fn(),
      } as any,
    );

    (service as any).sleep = jest.fn().mockResolvedValue(undefined);

    const client = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'open-valve-id',
            commandCode: 'OPEN_VALVE',
            commandStatus: 'acked',
            imei: 'valve-imei',
            targetDeviceId: 'valve-device',
            requestPayload: { role: 'valve' },
          },
          {
            id: 'start-pump-id',
            commandCode: 'START_PUMP',
            commandStatus: 'dead_letter',
            imei: 'well-imei',
            targetDeviceId: 'well-device',
            requestPayload: { role: 'pump' },
          },
        ],
      }),
    } as any;

    const result = await (service as any).dispatchPendingStartFailureCompensation({
      session: {
        id: 'session-1',
        tenantId: 'tenant-1',
        sessionRef: 'SIM-1',
        wellId: 'well-1',
        pumpId: 'pump-1',
        valveId: 'valve-1',
      },
      queuedCommands: [{ id: 'open-valve-id' }, { id: 'start-pump-id' }],
      orderId: 'order-1',
      reasonCode: 'sync_start_timeout',
      client,
    });

    expect(queueCommand).toHaveBeenCalledTimes(2);
    expect(queueCommand.mock.calls[0][0]).toMatchObject({
      command_code: 'CLOSE_VALVE',
      imei: 'valve-imei',
      order_id: 'order-1',
      session_id: 'session-1',
    });
    expect(queueCommand.mock.calls[1][0]).toMatchObject({
      command_code: 'STOP_PUMP',
      imei: 'well-imei',
      order_id: 'order-1',
      session_id: 'session-1',
    });
    expect(dispatchQueuedCommandNow).toHaveBeenNthCalledWith(1, 'stop-valve-token');
    expect(dispatchQueuedCommandNow).toHaveBeenNthCalledWith(2, 'stop-pump-token');
    expect(sessionStatusLogCreate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      roles: expect.arrayContaining(['valve', 'pump']),
    });
  });
});
