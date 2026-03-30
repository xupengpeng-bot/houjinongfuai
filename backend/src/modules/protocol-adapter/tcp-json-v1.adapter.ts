import { Injectable } from '@nestjs/common';
import { DeviceEnvelope } from './device-envelope';
import { DeviceRuntimeEvent } from './device-runtime-event';

@Injectable()
export class TcpJsonV1Adapter {
  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private mapEventType(msgType: string, payload: Record<string, unknown>): DeviceRuntimeEvent['eventType'] {
    const normalized = msgType.trim().toUpperCase();
    if (normalized === 'REGISTER' || normalized === 'REGISTERED') return 'DEVICE_REGISTERED';
    if (normalized === 'HEARTBEAT') return 'DEVICE_HEARTBEAT';
    if (normalized === 'STATE_SNAPSHOT') return 'DEVICE_STATE_SNAPSHOT';
    if (normalized === 'RUNTIME_TICK') return 'DEVICE_RUNTIME_TICK';
    if (normalized === 'RUNTIME_STOPPED') return 'DEVICE_RUNTIME_STOPPED';
    if (normalized === 'ALARM') return 'DEVICE_ALARM_RAISED';
    if (normalized === 'COMMAND_ACK') {
      const result = typeof payload.result === 'string' ? payload.result.trim().toLowerCase() : 'acked';
      return result === 'nack' || result === 'rejected' || result === 'failed'
        ? 'DEVICE_COMMAND_NACKED'
        : 'DEVICE_COMMAND_ACKED';
    }
    return 'DEVICE_STATE_SNAPSHOT';
  }

  toRuntimeEvent(envelope: DeviceEnvelope): DeviceRuntimeEvent {
    const payload = this.asObject(envelope.payload);
    const commandIdCandidate = payload.command_id ?? payload.commandId ?? null;
    const startTokenCandidate = payload.start_token ?? payload.startToken ?? null;

    return {
      eventType: this.mapEventType(envelope.msgType, payload),
      imei: envelope.imei,
      msgId: envelope.msgId,
      seqNo: envelope.seqNo,
      msgType: envelope.msgType,
      deviceTs: envelope.deviceTs,
      serverRxTs: envelope.serverRxTs,
      sessionRef: envelope.sessionRef ?? null,
      commandId: typeof commandIdCandidate === 'string' ? commandIdCandidate.trim() || null : null,
      startToken: typeof startTokenCandidate === 'string' ? startTokenCandidate.trim() || null : null,
      counters: {
        runtimeSec: envelope.cumulativeRuntimeSec ?? null,
        energyWh: envelope.cumulativeEnergyWh ?? null,
        flow: envelope.cumulativeFlow ?? null
      },
      payload,
      idempotencyKey: `${envelope.imei}:${envelope.msgId || `${envelope.seqNo}:${envelope.msgType}`}`,
      orderingKey: `${envelope.imei}:${envelope.seqNo}`,
      clockDriftSec: null
    };
  }
}
