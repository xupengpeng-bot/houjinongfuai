import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';
import { OrderRepository } from '../../src/modules/order/order.repository';
import { OrderSettlementService } from '../../src/modules/order/order-settlement.service';
import { TcpJsonV1Adapter } from '../../src/modules/protocol-adapter/tcp-json-v1.adapter';
import { SessionStatusLogRepository } from '../../src/modules/runtime/session-status-log.repository';
import { RuntimeIngestService } from '../../src/modules/runtime-ingest/runtime-ingest.service';

describe('DeviceGatewayService short envelope rules', () => {
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

  it('rejects legacy snake_case transport envelope fields', () => {
    expect(() =>
      (service as any).buildValidatedEnvelope({
        protocol: 'hj-device-v2',
        imei: '860000000000001',
        msg_id: 'MSG-STATE-0001',
        type: 'STATE_SNAPSHOT',
        seq: 101,
        ts: '2026-04-07T13:05:00Z',
        server_rx_ts: '2026-04-07T13:05:01Z',
        session_ref: 'SESSION-001',
        correlation_id: 'CMD-STATE-0001',
        run_state: 'RUNNING',
        power_state: 'ON',
        alarm_codes: ['LOW_BATTERY'],
        cumulative_runtime_sec: 120,
        cumulative_energy_wh: 25,
        cumulative_flow: 2.4,
        payload: {
          firmware_family: 'FW_H2_UNIFIED',
        },
      }),
    ).toThrow('short envelope v/t/i/m/s is required and v must equal 1');
  });

  it('accepts compact envelope fields and expands compact payload dictionaries', () => {
    const envelope = (service as any).buildValidatedEnvelope({
      v: 1,
      t: 'SS',
      i: '860000000000001',
      m: '000128',
      s: 128,
      r: 'S001',
      p: {
        wf: 'RN',
        cv: 3,
        ff: 'FW_H2_UNIFIED',
        fv: '2.0.0',
        fm: ['pvc', 'prs', 'flw'],
        cap_ver: 3,
        cap_hash: 'sha256:8d1a97f4c4d0f2b8',
        config_bitmap: '0x0000001f',
        actions_bitmap: '0x0000003f',
        queries_bitmap: '0x00000007',
        limits: {
          max_inflight_control: 1,
          event_queue_depth: 8,
          ota_block_bytes: 512,
        },
        rt: 180,
        ek: 0.52,
        fq: 4.8,
        ch: [
          { mc: 'prs', cc: 'ai1', mr: 'pr', v: 0.45, u: 'MPa', q: 1 },
          { mc: 'flw', cc: 'pl1', mr: 'fm', v: 12.4, u: 'm3/h', q: 1 },
        ],
      },
    });

    const event = adapter.toRuntimeEvent(envelope);

    expect(envelope.msgType).toBe('STATE_SNAPSHOT');
    expect(envelope.sessionRef).toBe('S001');
    expect(envelope.cumulativeRuntimeSec).toBe(180);
    expect(envelope.cumulativeEnergyWh).toBe(520);
    expect(envelope.cumulativeFlow).toBe(4.8);

    expect(event.payload.identity).toEqual(
      expect.objectContaining({
        firmware_family: 'FW_H2_UNIFIED',
        firmware_version: '2.0.0',
      }),
    );
    expect(event.payload.feature_modules).toEqual([
      'pump_vfd_control',
      'pressure_acquisition',
      'flow_acquisition',
    ]);
    expect(event.payload.capability_version).toBe(3);
    expect(event.payload.capability_hash).toBe('sha256:8d1a97f4c4d0f2b8');
    expect(event.payload.config_bitmap).toBe('0x0000001f');
    expect(event.payload.actions_bitmap).toBe('0x0000003f');
    expect(event.payload.queries_bitmap).toBe('0x00000007');
    expect(event.payload.limits).toEqual({
      max_inflight_control: 1,
      event_queue_depth: 8,
      ota_block_bytes: 512,
    });
    expect(event.payload.workflow_state).toBe('RUNNING');
    expect(event.payload.common_status).toEqual(
      expect.objectContaining({
        capability_version: 3,
        capability_hash: 'sha256:8d1a97f4c4d0f2b8',
      }),
    );
    expect(event.payload.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module_code: 'pressure_acquisition',
          channel_code: 'ai1',
          metric_code: 'pressure_mpa',
          value: 0.45,
          quality: 'good',
        }),
        expect.objectContaining({
          module_code: 'flow_acquisition',
          channel_code: 'pl1',
          metric_code: 'flow_m3h',
          value: 12.4,
          quality: 'good',
        }),
      ]),
    );
    expect(event.payload.channel_values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module_code: 'pump_vfd_control',
          channel_code: 'runtime_total',
          metric_code: 'runtime_sec',
          value: 180,
          quality: 'good',
        }),
        expect.objectContaining({
          module_code: 'pump_vfd_control',
          channel_code: 'meter_energy',
          metric_code: 'energy_kwh',
          value: 0.52,
          quality: 'good',
        }),
      ]),
    );
  });

  it('maps query result and command nack with correlation id to runtime event types', () => {
    const queryResult = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-QUERY-0001',
      seqNo: 21,
      msgType: 'QUERY_RESULT',
      deviceTs: '2026-04-07T13:09:00Z',
      serverRxTs: '2026-04-07T13:09:01Z',
      correlationId: 'CMD-QUERY-001',
      payload: {
        scope: 'common',
        query_code: 'query_common_status',
        online: true,
        ready: true,
        battery_soc: 87,
      },
    });

    const commandNack = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-NACK-0001',
      seqNo: 22,
      msgType: 'COMMAND_NACK',
      deviceTs: '2026-04-07T13:10:00Z',
      serverRxTs: '2026-04-07T13:10:01Z',
      payload: {
        command_id: 'CMD-001',
        reject_code: 'module_not_enabled',
      },
    });

    expect(queryResult.eventType).toBe('DEVICE_QUERY_RESULT');
    expect(queryResult.commandId).toBe('CMD-QUERY-001');
    expect(commandNack.eventType).toBe('DEVICE_COMMAND_NACKED');
    expect(commandNack.commandId).toBe('CMD-001');
  });

  it('maps card swipe request and reject event reports to dedicated runtime event types', () => {
    const swipeRequested = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-CARD-REQ-0001',
      seqNo: 31,
      msgType: 'EVENT_REPORT',
      deviceTs: '2026-04-08T10:00:00Z',
      serverRxTs: '2026-04-08T10:00:01Z',
      payload: {
        event_code: 'card_swipe_requested',
        card_token: 'FCARD-S01-DEMO',
      },
    });

    const swipeRejected = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-CARD-REJ-0001',
      seqNo: 32,
      msgType: 'EVENT_REPORT',
      deviceTs: '2026-04-08T10:00:02Z',
      serverRxTs: '2026-04-08T10:00:03Z',
      payload: {
        event_code: 'card_swipe_rejected',
        reader_reason: 'platform_offline',
      },
    });

    expect(swipeRequested.eventType).toBe('DEVICE_CARD_SWIPE_REQUESTED');
    expect(swipeRejected.eventType).toBe('DEVICE_CARD_SWIPE_REJECTED');
  });

  it('maps accepted platform checkout cse audits to card swipe requests but keeps debounce audits passive', () => {
    const acceptedCse = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-CSE-REQ-0001',
      seqNo: 33,
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

    const debouncedCse = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-CSE-DEB-0001',
      seqNo: 34,
      msgType: 'EVENT_REPORT',
      deviceTs: '2026-04-15T01:00:02Z',
      serverRxTs: '2026-04-15T01:00:03Z',
      payload: {
        ec: 'cse',
        rc: 'same_token_debounce',
        tr: 'card',
        msg: 'debounced|uart1_card_reader|552928',
      },
    });

    expect(acceptedCse.eventType).toBe('DEVICE_CARD_SWIPE_REQUESTED');
    expect(debouncedCse.eventType).toBe('DEVICE_STATE_SNAPSHOT');
  });

  it('normalizes compact ota event reports so gateway can track upgrade jobs', () => {
    const upgradeReport = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: 'MSG-UPG-0001',
      seqNo: 41,
      msgType: 'EVENT_REPORT',
      deviceTs: '2026-04-13T01:00:00Z',
      serverRxTs: '2026-04-13T01:00:02Z',
      payload: {
        ec: 'upg',
        ut: 'UPG-TOKEN-001',
        stg: 'failed',
        res: 'failed',
        pp: 70,
        rc: 'flash_write_failed',
        msg: 'flash write',
        fv: '0.1.22',
        sum: 'sha256:deadbeef',
      },
    });

    expect(upgradeReport.eventType).toBe('DEVICE_STATE_SNAPSHOT');
    expect(upgradeReport.payload.event_code).toBe('upg');
    expect(upgradeReport.payload.upgrade_token).toBe('UPG-TOKEN-001');
    expect(upgradeReport.payload.stage).toBe('failed');
    expect(upgradeReport.payload.result).toBe('failed');
    expect(upgradeReport.payload.progress_percent).toBe(70);
    expect(upgradeReport.payload.reason_code).toBe('flash_write_failed');
    expect(upgradeReport.payload.message).toBe('flash write');
    expect(upgradeReport.payload.firmware_version).toBe('0.1.22');
    expect(upgradeReport.payload.checksum).toBe('sha256:deadbeef');
  });

  it('keeps dedupe stable for retransmits but does not collide after device msg_id reset', () => {
    const firstHeartbeat = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: '860000000000001-25',
      seqNo: 25,
      msgType: 'HEARTBEAT',
      deviceTs: '2026-04-10T10:43:41Z',
      serverRxTs: '2026-04-10T10:43:42Z',
      payload: {
        online: true,
        ready: true,
      },
    });

    const retransmittedHeartbeat = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: '860000000000001-25',
      seqNo: 25,
      msgType: 'HEARTBEAT',
      deviceTs: '2026-04-10T10:43:41Z',
      serverRxTs: '2026-04-10T10:43:50Z',
      payload: {
        online: true,
        ready: true,
      },
    });

    const rebootedHeartbeat = adapter.toRuntimeEvent({
      protocol: 'hj-device-v2',
      protocolVersion: 'hj-device-v2',
      imei: '860000000000001',
      msgId: '860000000000001-25',
      seqNo: 25,
      msgType: 'HEARTBEAT',
      deviceTs: '2026-04-10T11:43:41Z',
      serverRxTs: '2026-04-10T11:43:42Z',
      payload: {
        online: true,
        ready: true,
      },
    });

    expect(firstHeartbeat.idempotencyKey).toBe(retransmittedHeartbeat.idempotencyKey);
    expect(firstHeartbeat.idempotencyKey).not.toBe(rebootedHeartbeat.idempotencyKey);
  });
});
