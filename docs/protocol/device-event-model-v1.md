# Device Event Model v1

## 目标
把 `tcp-json-v1` 原始报文转换为统一的领域事件，供 runtime / order / billing / alarm 消费。

## 分层
1. `device-gateway`
   - 连接管理
   - 粘包/拆包
   - `imei` 绑定
2. `protocol-adapter`
   - 原始 JSON -> `DeviceEnvelope`
   - `DeviceEnvelope` -> `DeviceRuntimeEvent`
3. `runtime-ingest`
   - 幂等去重
   - 顺序校正
   - 事件落库
   - 归属到 session/order

## DeviceEnvelope
```ts
interface DeviceEnvelope {
  protocolVersion: string;
  imei: string;
  msgId: string;
  seqNo: number;
  msgType: string;
  deviceTs: string | null;
  serverRxTs: string;
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
```

## DeviceRuntimeEvent
```ts
interface DeviceRuntimeEvent {
  eventType:
    | "DEVICE_REGISTERED"
    | "DEVICE_HEARTBEAT"
    | "DEVICE_STATE_SNAPSHOT"
    | "DEVICE_RUNTIME_TICK"
    | "DEVICE_RUNTIME_STOPPED"
    | "DEVICE_ALARM_RAISED"
    | "DEVICE_COMMAND_ACKED"
    | "DEVICE_COMMAND_NACKED";
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
```

## 归属规则
归属优先级固定：
1. `command_id`
2. `start_token`
3. `session_ref`
4. 同 `IMEI` 单活动会话兜底

若不能唯一归属：
- 事件照常落库
- 标记异常
- 不强行推进资金或订单

## reconnect after offline timeout
若旧订单已因 `OFFLINE_TIMEOUT_AUTO_END` 结束，而设备重连后仍自报 `RUNNING`：
1. 写审计日志
2. 发送 `STOP_COMMAND`
3. 等待 ACK / 超时
4. 触发告警 / 工单
5. 不恢复旧订单，不恢复旧会话

## 幂等
- 首选 `imei + msg_id`
- 次选 `imei + seq_no + msg_type`
- 相同幂等键不得重复推进状态和资金
