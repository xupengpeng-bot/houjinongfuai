import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';

describe('device gateway start failure compensation', () => {
  it('queues reverse commands for acked or timed-out start steps', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'open-valve-id',
            commandCode: 'OPEN_VALVE',
            commandStatus: 'acked',
            imei: 'valve-imei',
            targetDeviceId: 'valve-device',
            requestPayload: { command_plan: 'session_start' },
          },
          {
            id: 'start-pump-id',
            commandCode: 'START_PUMP',
            commandStatus: 'dead_letter',
            imei: 'pump-imei',
            targetDeviceId: 'pump-device',
            requestPayload: { command_plan: 'session_start' },
          },
        ],
      }),
    } as any;
    const sessionStatusLogCreate = jest.fn().mockResolvedValue(undefined);
    const service = new DeviceGatewayService(
      db,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { create: sessionStatusLogCreate } as any,
      {} as any,
      {} as any,
    );

    const queueCommandInClient = jest
      .fn()
      .mockResolvedValueOnce({
        command: {
          command_token: 'close-valve-token',
          command_code: 'CLOSE_VALVE',
        },
      })
      .mockResolvedValueOnce({
        command: {
          command_token: 'stop-pump-token',
          command_code: 'STOP_PUMP',
        },
      });
    const dispatchQueuedCommandTokensNow = jest.fn().mockResolvedValue([
      { command_token: 'close-valve-token', delivered: true },
      { command_token: 'stop-pump-token', delivered: true },
    ]);

    (service as any).queueCommandInClient = queueCommandInClient;
    (service as any).dispatchQueuedCommandTokensNow = dispatchQueuedCommandTokensNow;

    const result = await (service as any).dispatchPendingStartFailureCompensation(
      {
        id: 'session-1',
        tenantId: 'tenant-1',
        sessionNo: 'SIM-1',
        sessionRef: 'SIM-1',
        status: 'ended',
      },
      'order-1',
      'sync_start_timeout',
      {} as any,
    );

    expect(queueCommandInClient).toHaveBeenCalledTimes(2);
    expect(queueCommandInClient.mock.calls[0][0]).toMatchObject({
      command_code: 'CLOSE_VALVE',
      target_device_id: 'valve-device',
      imei: 'valve-imei',
      order_id: 'order-1',
    });
    expect(queueCommandInClient.mock.calls[1][0]).toMatchObject({
      command_code: 'STOP_PUMP',
      target_device_id: 'pump-device',
      imei: 'pump-imei',
      order_id: 'order-1',
    });
    expect(dispatchQueuedCommandTokensNow).toHaveBeenCalledWith(['close-valve-token', 'stop-pump-token']);
    expect(sessionStatusLogCreate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      queuedCommands: expect.arrayContaining([
        expect.objectContaining({ command_token: 'close-valve-token' }),
        expect.objectContaining({ command_token: 'stop-pump-token' }),
      ]),
    });
  });
});
