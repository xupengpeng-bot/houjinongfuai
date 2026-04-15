export interface DeviceEnvelope {
  protocol: string;
  protocolVersion: string;
  imei: string;
  msgId: string;
  seqNo: number;
  msgType: string;
  deviceTs: string | null;
  serverRxTs: string;
  correlationId?: string | null;
  sessionRef?: string | null;
  runState?: string | null;
  powerState?: string | null;
  alarmCodes?: string[];
  cumulativeRuntimeSec?: number | null;
  cumulativeEnergyWh?: number | null;
  cumulativeFlow?: number | null;
  payload: Record<string, unknown>;
  integrity?: Record<string, unknown>;
}
