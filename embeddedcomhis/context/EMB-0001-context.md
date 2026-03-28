# EMB-0001 Context

## 协议冻结结论

- 传输层：TCP 长连接
- 编码：4 字节大端长度头 + UTF-8 JSON
- 设备业务主键：`IMEI`
- 同一 `IMEI` 新连接覆盖旧连接
- 幂等优先键：`imei + msg_id`
- 次选幂等键：`imei + seq_no + msg_type`

## 当前设备侧应重点关注

1. `REGISTER` 是否稳定带出固件版本
2. `RUNTIME_TICK` 是否稳定携带累计计量值
3. `COMMAND_ACK / COMMAND_NACK` 是否有可追踪字段
4. 重连时是否能明确打印旧连接被覆盖日志

## 这轮不要做什么

- 不切多协议
- 不做二进制协议主线
- 不做 AI 控制
