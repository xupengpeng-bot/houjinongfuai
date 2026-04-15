import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';
import { OrderRepository } from '../../src/modules/order/order.repository';
import { OrderSettlementService } from '../../src/modules/order/order-settlement.service';
import { TcpJsonV1Adapter } from '../../src/modules/protocol-adapter/tcp-json-v1.adapter';
import { SessionStatusLogRepository } from '../../src/modules/runtime/session-status-log.repository';
import { RuntimeIngestService } from '../../src/modules/runtime-ingest/runtime-ingest.service';

describe('DeviceGatewayService command dispatch wrappers', () => {
  const adapter = new TcpJsonV1Adapter();
  const service = new DeviceGatewayService(
    {} as DatabaseService,
    { get: jest.fn() } as unknown as ConfigService,
    adapter,
    {} as OrderRepository,
    {} as OrderSettlementService,
    {} as SessionStatusLogRepository,
    {} as RuntimeIngestService,
    { get: jest.fn() } as unknown as ModuleRef,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('dispatchQuery wraps payload into QUERY command envelope', async () => {
    const queueSpy = jest.spyOn(service, 'queueCommand').mockResolvedValue({ id: 'cmd-1' } as never);

    await service.dispatchQuery({
      imei: '860000000000001',
      qc: 'qcs',
      scope: 'common',
      metric_codes: ['battery_soc', 'signal_csq'],
    });

    expect(queueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        imei: '860000000000001',
        command_code: 'QUERY',
        request_payload: expect.objectContaining({
          scope: 'common',
          query_code: 'query_common_status',
          metric_codes: ['battery_soc', 'signal_csq'],
        }),
      }),
    );
  });

  it('dispatchExecuteAction wraps payload into EXECUTE_ACTION command envelope', async () => {
    const queueSpy = jest.spyOn(service, 'queueCommand').mockResolvedValue({ id: 'cmd-2' } as never);

    await service.dispatchExecuteAction({
      target_device_id: '00000000-0000-0000-0000-00000000d001',
      ac: 'ovl',
      scope: 'module',
      channel_code: 'valve_1',
    });

    expect(queueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        target_device_id: '00000000-0000-0000-0000-00000000d001',
        command_code: 'EXECUTE_ACTION',
        request_payload: expect.objectContaining({
          scope: 'module',
          action_code: 'open_valve',
          module_code: 'single_valve_control',
          target_ref: 'valve_1',
        }),
      }),
    );
  });

  it('maps business command codes into compact short-protocol wire messages', () => {
    const wire = (service as any).buildWireCommandEnvelope({
      commandToken: '8c6eb48d-fd9d-4b2c-aef3-df4f5fa625db',
      commandCode: 'START_PUMP',
      imei: '860000000000099',
      sessionRef: 'S-6601D010',
      requestMsgId: 'cmd-start-pump',
      requestSeqNo: 9001,
      requestPayload: {},
    });

    expect(wire).toEqual(
      expect.objectContaining({
        v: 1,
        t: 'EX',
        i: '860000000000099',
        m: 'cmd-start-pump',
        s: 9001,
        c: '8c6eb48d-fd9d-4b2c-aef3-df4f5fa625db',
        r: 'S-6601D010',
        p: expect.objectContaining({
          sc: 'md',
          mc: 'pdc',
          ac: 'spu',
          tr: 'pump_1',
        }),
      }),
    );
  });

  it('dispatchSyncConfig wraps payload into SYNC_CONFIG command envelope', async () => {
    const queueSpy = jest.spyOn(service, 'queueCommand').mockResolvedValue({ id: 'cmd-3' } as never);

    await service.dispatchSyncConfig({
      imei: '860000000000009',
      config_version: 3,
      firmware_family: 'FW_H2_UNIFIED',
      feature_modules: ['pump_vfd_control', 'pressure_acquisition'],
      channel_bindings: [{ channel_code: 'pressure_1' }],
    });

    expect(queueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        imei: '860000000000009',
        command_code: 'SYNC_CONFIG',
        request_payload: expect.objectContaining({
          config_version: 3,
          firmware_family: 'FW_H2_UNIFIED',
          feature_modules: ['pump_vfd_control', 'pressure_acquisition'],
          channel_bindings: [{ channel_code: 'pressure_1' }],
        }),
      }),
    );
  });
});
