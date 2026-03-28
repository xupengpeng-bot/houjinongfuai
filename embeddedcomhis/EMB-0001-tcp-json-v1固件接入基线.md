这是协作任务状态，不代表嵌入式实现已验收；实现完成以 commit SHA、固件版本、测试记录为准。

# EMB-0001 tcp-json-v1 固件接入基线

## 1. 当前阶段

- Phase 1

## 2. 当前状态

- 后端协议文档已冻结
- 模拟器骨架已存在
- 真实固件接入与日志口径尚未形成统一基线

## 3. 任务类型

- 协议实现基线
- 固件日志口径基线

## 4. 任务目标

1. 基于 `tcp-json-v1` 输出固件接入清单
2. 明确设备侧最小必发消息与字段
3. 明确重连、重复包、ACK/NACK、离线超时相关日志口径
4. 产出一份可供后端联调使用的真实样例日志

## 5. 目标范围

- 协议：`tcp-json-v1`
- 设备标识：`IMEI`
- 消息范围：
  - `REGISTER`
  - `HEARTBEAT`
  - `STATE_SNAPSHOT`
  - `RUNTIME_TICK`
  - `RUNTIME_STOPPED`
  - `COMMAND_ACK`
  - `COMMAND_NACK`

## 6. 输入资料

- `context/EMB-0001-context.md`
- `fixtures/EMB-0001/device-message-minimum.json`
- `fixtures/EMB-0001/expected-log-fields.md`

## 7. 输出要求

1. commit SHA 或固件版本
2. 设备侧消息清单
3. 日志样例
4. 已支持 / 未支持项
5. Pending issue
