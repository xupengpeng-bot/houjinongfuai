export interface DeviceRuntimeEvent {
  eventType:
    | 'DEVICE_REGISTERED'
    | 'DEVICE_HEARTBEAT'
    | 'DEVICE_STATE_SNAPSHOT'
    | 'DEVICE_RUNTIME_TICK'
    | 'DEVICE_RUNTIME_STOPPED'
    | 'DEVICE_ALARM_RAISED'
    | 'DEVICE_COMMAND_ACKED'
    | 'DEVICE_COMMAND_NACKED';
  imei: string;
  msgId: string;
  seqNo: number;
  msgType: string;
  deviceTs: string | null;
  serverRxTs: string;
  sessionRef?: string | null;
  commandId?: string | null;
  startToken?: string | null;
  counters: {
    runtimeSec?: number | null;
    energyWh?: number | null;
    flow?: number | null;
  };
  payload: Record<string, unknown>;
  idempotencyKey: string;
  orderingKey: string;
  clockDriftSec?: number | null;
}
