# Device Protocol v1

## 范围
- 协议名：`tcp-json-v1`
- 适用阶段：`Phase 1`
- 传输层：TCP 长连接
- 编码：4 字节大端长度头 + UTF-8 JSON body

## 设计目标
- 让嵌入式实现难度可控
- 便于本地模拟器与 UAT
- 便于排查协议与结算问题
- 为后续 binary protocol 预留适配层，但 Phase 1 不优先实现 binary

## 连接模型
- 每个设备连接必须先 `REGISTER`
- 设备唯一业务键：`imei`
- 同一 `imei` 新连接覆盖旧连接
- 覆盖旧连接时必须记录审计日志

## 上行消息
- `REGISTER`
- `HEARTBEAT`
- `STATE_SNAPSHOT`
- `RUNTIME_TICK`
- `RUNTIME_STOPPED`
- `ALARM_REPORT`
- `COMMAND_ACK`
- `COMMAND_NACK`

## 下行消息
- `START_COMMAND`
- `STOP_COMMAND`
- `QUERY_STATE`

## 通用报文头字段
```json
{
  "protocol_version": "tcp-json-v1",
  "imei": "860000000000001",
  "msg_id": "MSG-000001",
  "seq_no": 1001,
  "msg_type": "STATE_SNAPSHOT",
  "device_ts": "2026-03-22T08:00:00Z",
  "session_ref": "SES-REF-S01",
  "run_state": "RUNNING",
  "power_state": "ON",
  "alarm_codes": [],
  "cumulative_runtime_sec": 120,
  "cumulative_energy_wh": 350,
  "cumulative_flow": 2.6,
  "payload": {},
  "integrity": {
    "kind": "signature_stub",
    "value": "stub"
  }
}
```

## 字段要求
- `imei`：业务主键和通信唯一键
- `msg_id`：同一设备消息幂等主键之一
- `seq_no`：顺序校正与乱序容忍辅助键
- `device_ts`：UTC 时间
- `session_ref`：设备若能回带，优先用于订单/会话归属
- `cumulative_runtime_sec / cumulative_energy_wh / cumulative_flow`：优先作为计费依据

## 时间规则
- 设备时间统一使用 UTC
- 允许时钟漂移 `±300s`
- 漂移过大时消息仍可入库，但结算需降级处理

## 长连接行为
- 服务端维护 `imei -> active connection`
- 新连接覆盖旧连接
- 心跳与运行态上报都可刷新设备在线时间
- `offline_timeout_sec = 600`

## Phase 1 不做
- 真实 CRC 校验实现
- 二进制协议主实现
- 多协议网关并行正式运营
