# 嵌入式控制器标准报文样例包 v1

## 1. 目的

这份文档配合下面这些定义一起使用：

- [embedded-controller-capability-composition-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-capability-composition-v1.md)
- [embedded-controller-dictionaries-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-dictionaries-v1.md)
- [device-protocol-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/device-protocol-v1.md)

目标是给：

- 嵌入式固件
- 平台后端
- 设备网关
- 联调测试

一套可以直接对照的标准样例包。

## 2. 样例文件列表

样例文件放在：

- [embedded-controller-v1](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1)

当前包含：

1. [register-h2-unified.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/register-h2-unified.json)
2. [state-snapshot-vfd-pressure-flow.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/state-snapshot-vfd-pressure-flow.json)
3. [sync-config-vfd-pressure-flow.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/sync-config-vfd-pressure-flow.json)
4. [sync-config-valve-soil-combo.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/sync-config-valve-soil-combo.json)
5. [command-ack-open-valve.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/command-ack-open-valve.json)
6. [command-nack-module-not-enabled.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/command-nack-module-not-enabled.json)

## 3. 必须先统一的报文共识

### 3.1 报文头固定字段

所有消息统一保留：

- `protocol_version`
- `imei`
- `msg_id`
- `seq_no`
- `msg_type`
- `device_ts`

可选但建议统一保留：

- `session_ref`
- `run_state`
- `power_state`
- `alarm_codes`
- `payload`

### 3.2 平台和固件共同遵守

- 平台和固件都只认 code，不认中文
- 配置切换只走 `config_version`
- 设备侧当前启用模块必须在：
  - `REGISTER.payload.feature_modules`
  - `STATE_SNAPSHOT.payload.feature_modules`
  中明确体现

## 4. REGISTER 规则

注册消息用于声明：

- 这是谁
- 烧的什么固件
- 当前启用了哪些功能模块
- 当前配置版本是多少

推荐使用：

- [register-h2-unified.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/register-h2-unified.json)

关键字段：

- `firmware_family`
- `controller_role`
- `feature_modules`
- `config_version`
- `resource_inventory`

## 5. STATE_SNAPSHOT 规则

状态快照必须同时表达：

- 控制器整体状态
- 当前启用模块
- 通道状态
- 关键采集值

推荐使用：

- [state-snapshot-vfd-pressure-flow.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/state-snapshot-vfd-pressure-flow.json)

关键要求：

- `channels[]` 必填
- 每个通道要带：
  - `channel_code`
  - `channel_role`
  - `io_kind`
  - `enabled`
  - `state` 或 `value`

## 6. SYNC_CONFIG 规则

平台下发配置时，建议：

- 始终下发完整配置
- 不做局部 patch
- 设备收到后先校验，再 ACK

两个组合样例：

- 变频器 + 压力 + 流量
  - [sync-config-vfd-pressure-flow.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/sync-config-vfd-pressure-flow.json)
- 单阀 + 土壤墒情
  - [sync-config-valve-soil-combo.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/sync-config-valve-soil-combo.json)

配置主体固定包含：

- `firmware_family`
- `controller_role`
- `feature_modules`
- `resource_inventory`
- `channel_bindings`
- `runtime_rules`

## 7. ACK / NACK 规则

### 7.1 ACK

推荐使用：

- [command-ack-open-valve.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/command-ack-open-valve.json)

ACK 只表示：

- 已接单
- 接受执行

不表示：

- 动作已经完成

### 7.2 NACK

推荐使用：

- [command-nack-module-not-enabled.json](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/examples/embedded-controller-v1/command-nack-module-not-enabled.json)

NACK 必须说明：

- 哪个命令
- 为什么拒绝
- 拒绝码是什么

## 8. 建议的联调顺序

建议按下面顺序做联调：

1. `REGISTER`
2. `STATE_SNAPSHOT`
3. `SYNC_CONFIG`
4. `COMMAND_ACK / COMMAND_NACK`
5. `RUNTIME_TICK`
6. `RUNTIME_STOPPED`

## 9. Phase 1 最小闭环

如果现在只做最小闭环，我建议先打通这 2 组：

### 9.1 水源控制闭环

- 模块：
  - `pump_vfd_control`
  - `pressure_acquisition`
  - `flow_acquisition`
  - `power_monitoring`

### 9.2 单阀监测闭环

- 模块：
  - `single_valve_control`
  - `valve_feedback_monitor`
  - `soil_moisture_acquisition`
  - `soil_temperature_acquisition`

## 10. 下一步建议

有了这套样例包之后，下一步最顺的是：

1. 后端把 `config_body` 落成 JSON Schema / DTO
2. 嵌入式按这组样例实现消息编解码
3. 平台后台按 `feature_modules + channel_bindings` 出统一配置页

