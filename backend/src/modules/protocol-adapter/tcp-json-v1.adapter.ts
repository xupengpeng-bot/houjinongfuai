import { Injectable } from '@nestjs/common';
import { DeviceEnvelope } from './device-envelope';
import { DeviceRuntimeEvent } from './device-runtime-event';

@Injectable()
export class TcpJsonV1Adapter {
  toRuntimeEvent(envelope: DeviceEnvelope): DeviceRuntimeEvent {
    return {
      eventType: 'DEVICE_STATE_SNAPSHOT',
      imei: envelope.imei,
      msgId: envelope.msgId,
      seqNo: envelope.seqNo,
      msgType: envelope.msgType,
      deviceTs: envelope.deviceTs,
      serverRxTs: envelope.serverRxTs,
      sessionRef: envelope.sessionRef ?? null,
      counters: {
        runtimeSec: envelope.cumulativeRuntimeSec ?? null,
        energyWh: envelope.cumulativeEnergyWh ?? null,
        flow: envelope.cumulativeFlow ?? null
      },
      payload: envelope.payload,
      idempotencyKey: `${envelope.imei}:${envelope.msgId || `${envelope.seqNo}:${envelope.msgType}`}`,
      orderingKey: `${envelope.imei}:${envelope.seqNo}`,
      clockDriftSec: null
    };
  }
}
