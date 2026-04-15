# 设备 TCP 短协议 v2

## 1. 结论

`hj-device-v2` 是平台与嵌入式控制器之间唯一的 TCP 线协议。

- 只允许短协议
- 不再兼容长 envelope
- 不再把 `tcp-json-v1`、`snake_case` 顶层字段、`protocol/type/msg_id/payload` 当作 TCP 对外交互格式

平台内部如需保留 `query_code`、`action_code`、`feature_modules` 等长语义，只是内部归一结果，不代表 MCU 线协议格式。

## 2. 传输层

- 传输方式：TCP
- 帧格式：`[4-byte big-endian length][utf-8 json bytes]`
- 单帧编码：UTF-8 JSON
- 顶层只允许：`v/t/i/m/s/c/r/p/ts`

## 3. 通用 Envelope

```json
{
  "v": 1,
  "t": "HB",
  "i": "864869000000001",
  "m": "hb-0001",
  "s": 1,
  "ts": "2026-04-12T10:00:00Z",
  "c": "cmd-001",
  "r": "S-6601D010",
  "p": {}
}
```

字段含义：

- `v`: 协议版本，固定 `1`
- `t`: 消息类型短码
- `i`: 设备 IMEI
- `m`: 消息 ID
- `s`: 本地递增序号
- `c`: 关联命令 ID，可选
- `r`: 会话引用，可选
- `ts`: 设备时间，可选
- `p`: 业务 payload

禁止的顶层字段：

- `protocol`
- `type`
- `imei`
- `msg_id`
- `seq`
- `payload`
- `query_code`
- `action_code`

## 4. 消息类型短码

| 短码 | 含义 |
| --- | --- |
| `RG` | REGISTER |
| `HB` | HEARTBEAT |
| `SS` | STATE_SNAPSHOT |
| `ER` | EVENT_REPORT |
| `QR` | QUERY |
| `QS` | QUERY_RESULT |
| `EX` | EXECUTE_ACTION |
| `SC` | SYNC_CONFIG |
| `AK` | COMMAND_ACK |
| `NK` | COMMAND_NACK |

## 5. 业务短码

查询短码：

- `qcs` = `query_common_status`
- `qwf` = `query_workflow_state`
- `qem` = `query_electric_meter`
- `qgs` = `query_upgrade_status`
- `qgc` = `query_upgrade_capability`

动作短码：

- `spu` = `start_pump`
- `tpu` = `stop_pump`
- `ovl` = `open_valve`
- `cvl` = `close_valve`
- `pas` = `pause_session`
- `res` = `resume_session`
- `ppu` = `play_voice_prompt`
- `upg` = `upgrade_firmware`
- `rbt` = `reboot_device`

作用域短码：

- `cm` = `common`
- `md` = `module`
- `wf` = `workflow`

## 6. Payload 关键字段

常用字段：

- `qc`: query code
- `ac`: action code
- `sc`: scope code
- `mc`: module code
- `tr`: target ref
- `cv`: config version
- `fm`: feature modules
- `cap_ver`: capability version
- `cap_hash`: capability hash
- `config_bitmap`: config capability bitmap
- `actions_bitmap`: action capability bitmap
- `queries_bitmap`: query capability bitmap
- `limits`: capability limits
- `ri`: resource inventory
- `cb`: channel bindings
- `rr`: runtime rules
- `ch`: channels

`rr` 中至少应支持：

- `heartbeat_interval_sec`
- `snapshot_idle_interval_sec`
- `snapshot_running_interval_sec`

能力集的正式语义不是只有 `fm`。
配置项、控制项、查询项和限制项都属于能力集内容；平台不得只把能力集理解成模块列表或动作列表。
在能力集版本化治理下，平台应依据 `cap_hash` 同时约束配置入口、查询入口和控制入口。

## 7. 关键运行语义

### 7.1 HEARTBEAT 是租约续命，不是傻发定时包

- `HB` 的正式语义是 lease keepalive
- 默认租约窗口建议 `30s ~ 60s`
- 心跳发送周期必须支持通过 `SC.p.rr.heartbeat_interval_sec` 配置
- 在租约窗口内如果设备已经发送了 `SS`、`ER`、`QS` 等上行业务消息，则不应额外补发冗余 `HB`
- `HB` 应只携带轻量运行态字段，不应承载全量遥测
- `HB` 必须携带当前 `cap_hash` 与 `cv`，用于平台快速校验能力集与配置版本是否收敛

### 7.1.1 STATE_SNAPSHOT 周期也是正式可配置项

- 状态快照周期必须支持通过 `SC.p.rr.snapshot_idle_interval_sec` 与 `SC.p.rr.snapshot_running_interval_sec` 分别配置
- 设备可按运行态再做更细分的内部调度，但对平台合同应有明确的基础快照周期
- 空闲期和运行期可以不同，但都不应脱离平台下发的基础周期约束

### 7.2 EXECUTE_ACTION 是实时控制，不允许设备侧缓存或排队

- 控制类 `EX` 只允许实时执行
- 设备侧不允许保留待执行控制队列
- 设备侧不允许离线缓存普通控制命令
- 当前控制命令完成、拒绝、失败或超时后，必须立即清空本地控制上下文
- 设备重连或重启后不得自动回放历史控制命令
- `AK` 仅表示设备接受本次执行请求，不等于物理动作已经最终成功
- `rbt` 属于正式副作用控制，必须先发出 `AK`，再在 ACK 成功发送后延迟执行 MCU 重启
- `rbt` 的目标应为空或 `controller`，设备在 OTA 活跃阶段或灌溉会话 `STARTING/RUNNING/STOPPING` 中必须返回 `NK/DEVICE_BUSY`
- 控制类最终结果应继续通过 `ER + SS` 收敛

### 7.3 OTA 只认 manifest，并且只在 boot_confirmed 后判成功

- `upg` 应下发升级事务 manifest，而不是“直接给 URL 就下载”
- manifest 至少应包含目标型号、目标版本、制品摘要、下载地址、`ETag`、包大小、过期时间和签名
- 设备下载前必须校验 `Content-Type=application/octet-stream`、`Accept-Ranges=bytes`、响应 `ETag` 与 manifest 一致、`Content-Length` 与剩余包大小一致
- `qgs` 应至少返回 `ota_stage / ota_state / download_progress_pct / write_progress_pct / last_result / last_error_code / current_version / target_version / package_sha256_hex / package_etag`
- 平台可接受 `accepted/downloading/downloaded/verified/staged/scheduled/rebooting/boot_confirmed/failed` 等阶段上报
- 平台只在 `boot_confirmed` 后判定升级成功
- 设备侧与平台侧统一以 `boot_confirmed` 作为唯一成功阶段，不再保留 `succeeded` 旧口径

### 7.4 平台审计队列不等于设备执行队列

- 平台内部可以保留 `device_command`、`retry_pending`、`dead_letter` 等审计与投递状态
- 这些都属于平台真相源和 sidecar bridge 交付能力，不表示设备侧允许缓存或排队控制命令
- `bridge/heartbeat` 或 `pending-commands` 仅适用于 HTTP bridge/串口 bridge 之类的桥接接入，不是 MCU TCP 主协议语义

## 8. 示例

### REGISTER

```json
{
  "v": 1,
  "t": "RG",
  "i": "864869000000001",
  "m": "reg-0001",
  "s": 1,
  "ts": "2026-04-12T10:00:00Z",
  "p": {
    "controller_code": "scan_irrigation_controller_trial_v1",
    "device_name": "扫码灌溉控制器",
    "iccid": "89860000000000000000",
    "hs": "SCAN-IRR-CTRL-4G",
    "hr": "A01",
    "ff": "SCAN-IRRIGATION-CONTROL",
    "fv": "0.1.23",
    "protocol_version": "1.0.0",
    "cv": 1,
    "fm": ["ebr", "bkr", "bkf"],
    "cap_ver": 4,
    "cap_hash": "sha256:4cf61f6b1a2c0d99",
    "config_bitmap": "0x0000001f",
    "actions_bitmap": "0x000000f3",
    "queries_bitmap": "0x0000001f",
    "limits": {
      "max_inflight_control": 1,
      "event_queue_depth": 8,
      "ota_block_bytes": 512
    },
    "ri": {
      "relay_output": 2,
      "digital_input": 4,
      "analog_input": 3,
      "net_session": 1
    },
    "time_synced": true
  }
}
```

### QUERY

```json
{
  "v": 1,
  "t": "QR",
  "i": "864869000000001",
  "m": "query-0001",
  "s": 100,
  "c": "cmd-query-0001",
  "r": "S-6601D010",
  "p": {
    "sc": "cm",
    "qc": "qcs"
  }
}
```

### EXECUTE_ACTION

```json
{
  "v": 1,
  "t": "EX",
  "i": "864869000000001",
  "m": "action-0001",
  "s": 101,
  "c": "cmd-action-0001",
  "r": "S-6601D010",
  "p": {
    "sc": "md",
    "ac": "ovl",
    "mc": "svl",
    "tr": "valve_1"
  }
}
```

### COMMAND_ACK

```json
{
  "v": 1,
  "t": "AK",
  "i": "864869000000001",
  "m": "ack-0001",
  "s": 102,
  "c": "cmd-action-0001",
  "r": "S-6601D010",
  "p": {
    "result": "accepted",
    "ac": "ovl",
    "tr": "valve_1"
  }
}
```

## 9. 平台内部归一

平台收到短协议后，会在内部归一为现有语义，例如：

- `qcs -> query_common_status`
- `spu -> start_pump`
- `ovl -> open_valve`

这一步只发生在平台内部，不构成线协议兼容承诺。

## 10. 实施要求

- 新固件开发默认短协议，不要再问“是否兼容长协议”。
- 新 TCP 示例、联调脚本、测试数据都必须使用短协议。
- 任何出现长 envelope 的文档，都应视为历史噪声并及时清理。
