# 新产品消息契约模板

## 1. 目的

用于冻结这个新产品的消息口径，避免联调时反复修改。

本模板主要回答：

- 上行支持哪些报文
- 下行支持哪些命令
- 每类消息最小字段是什么
- 字段语义、ACK 条件、完成条件是什么

## 2. 权威口径

这一条必须先看清楚：

- 嵌入式设备上行线协议默认使用轻量短字段协议
- 平台网关层负责把短字段映射成平台内部长语义
- 本模板里出现的长字段名，默认表示语义名或平台内部字段名，不表示 MCU 必须按长字段直接组包

嵌入式线协议必须以这两份为准：

- [embedded-controller-compact-protocol-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md)
- [embedded-controller-compact-dictionaries-v1.md](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md)

`device-protocol-v2.md` 这类文档只作为历史/平台语义参考，不作为新产品默认上行协议。

## 3. 顶层消息

| 语义消息名 | 短码 | 是否支持 | 说明 |
| --- | --- | --- | --- |
| `REGISTER` | `RG` | `Y/N` | `[待填写]` |
| `HEARTBEAT` | `HB` | `Y/N` | `[待填写]` |
| `STATE_SNAPSHOT` | `SS` | `Y/N` | `[待填写]` |
| `EVENT_REPORT` | `ER` | `Y/N` | `[待填写]` |
| `COMMAND_ACK` | `AK` | `Y/N` | `[待填写]` |
| `COMMAND_NACK` | `NK` | `Y/N` | `[待填写]` |
| `QUERY` | `QR` | `Y/N` | `[待填写]` |
| `QUERY_RESULT` | `QS` | `Y/N` | `[待填写]` |
| `EXECUTE_ACTION` | `EX` | `Y/N` | `[待填写]` |
| `SYNC_CONFIG` | `SC` | `Y/N` | `[待填写]` |

## 4. 顶层 envelope

| 语义字段 | 短字段 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `protocol_version` | `v` | `Y` | 当前默认 `1` |
| `message_type` | `t` | `Y` | 使用短码 |
| `imei` | `i` | `Y` | 设备主身份 |
| `msg_id` | `m` | `Y` | 本地消息号 |
| `seq` | `s` | `Y` | 本地递增序号 |
| `correlation_id` | `c` | `N` | 回执关联命令 |
| `session_ref` | `r` | `N` | 运行会话 |
| `payload` | `p` | `Y` | 业务载荷 |

## 5. 上行最小字段要求

### 5.1 注册 `RG`

最小建议字段：

- `v`
- `t=RG`
- `i`
- `m`
- `s`
- `p.ff`
- `p.fv`
- `p.cv`
- `p.fm`

### 5.2 心跳 `HB`

最小建议字段：

- `v`
- `t=HB`
- `i`
- `m`
- `s`
- `p.rd`
- `p.wf`
- `p.cv`

按场景可选：

- `p.csq`
- `p.bs`
- `p.bv`
- `p.sv`
- `p.pm`

### 5.3 状态快照 `SS`

最小建议字段：

- `v`
- `t=SS`
- `i`
- `m`
- `s`
- `p.wf`

按能力集补充：

- 时间计量：`p.rt`
- 电量计量：`p.ew` 或 `p.ek`
- 水量计量：`p.fq`
- 通道值：`p.ch`

## 6. 查询接口

| 语义 scope | 短码 | 语义 query_code | 短码 | 输入 | 输出 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `common` | `cm` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | |
| `module` | `md` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | |
| `workflow` | `wf` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | |

## 7. 动作接口

| 语义 scope | 短码 | 语义 action_code | 短码 | target_ref | 输入参数 | ACK 条件 | 完成条件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `module` | `md` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` |
| `workflow` | `wf` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` |

## 8. 事件模型

| 语义事件码 | 短码 | 含义 | 触发条件 | 是否告警 | 是否平台展示 |
| --- | --- | --- | --- | --- | --- |
| `[待填写]` | `[待填写]` | `[待填写]` | `[待填写]` | `Y/N` | `Y/N` |

## 9. 状态字段

### 9.1 通用状态

| 语义字段 | 短字段 | 类型 | 含义 | 取值口径 |
| --- | --- | --- | --- | --- |
| `ready` | `rd` | `[待填写]` | `[待填写]` | `[待填写]` |
| `workflow_state` | `wf` | `[待填写]` | `[待填写]` | `[待填写]` |
| `config_version` | `cv` | `[待填写]` | `[待填写]` | `[待填写]` |

### 9.2 计量字段

| 语义字段 | 短字段 | 是否启用 | 说明 |
| --- | --- | --- | --- |
| `cumulative_runtime_sec` | `rt` | `Y/N` | `[待填写]` |
| `cumulative_energy_wh` | `ew` | `Y/N` | `[待填写]` |
| `cumulative_energy_kwh` | `ek` | `Y/N` | `[待填写]` |
| `cumulative_flow` | `fq` | `Y/N` | `[待填写]` |

### 9.3 通道字段

| 语义字段 | 短字段 | 说明 |
| --- | --- | --- |
| `module_code` | `mc` | 模块短码 |
| `channel_code` | `cc` | 通道号 |
| `metric_code` | `mr` | 指标短码 |
| `value` | `v` | 数值 |
| `unit` | `u` | 单位 |
| `quality` | `q` | 质量位 |

## 10. 示例报文

### 10.1 注册 `RG`

```json
{
  "v": 1,
  "t": "RG",
  "i": "[待填写]",
  "m": "[待填写]",
  "s": 1,
  "p": {
    "ff": "[待填写]",
    "fv": "[待填写]",
    "cv": 1,
    "fm": ["[待填写]"]
  }
}
```

### 10.2 心跳 `HB`

```json
{
  "v": 1,
  "t": "HB",
  "i": "[待填写]",
  "m": "[待填写]",
  "s": 2,
  "p": {
    "rd": 1,
    "wf": "RI",
    "cv": 1
  }
}
```

### 10.3 状态快照 `SS`

```json
{
  "v": 1,
  "t": "SS",
  "i": "[待填写]",
  "m": "[待填写]",
  "s": 3,
  "p": {
    "wf": "RN",
    "rt": 180,
    "ch": [
      { "mc": "[待填写]", "cc": "[待填写]", "mr": "[待填写]", "v": 1, "u": "[待填写]", "q": 1 }
    ]
  }
}
```

### 10.4 动作下发 `EX`

```json
{
  "v": 1,
  "t": "EX",
  "i": "[待填写]",
  "m": "[待填写]",
  "s": 1001,
  "c": "[待填写]",
  "p": {
    "sc": "md",
    "ac": "[待填写]",
    "tr": "[待填写]",
    "pm": {}
  }
}
```

## 11. 变更规则

- 新增字段可以，但必须先判断是否真的必要
- 新增 MCU 上行字段，优先新增短字段，不要默认新增长字段
- 长语义名称一旦变化，必须同步评估平台映射
- 新增 `query_code`、`action_code`、事件码、模块码、指标码时，必须同步更新公共字典文档
