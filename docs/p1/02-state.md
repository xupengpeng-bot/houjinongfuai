# 状态机文档

## 1. 状态机设计原则

- 状态名必须稳定，避免前后端、测试、日志、UAT 使用不同口径。
- 状态转移只能由后端驱动，前端只发起动作和刷新结果。
- 每次关键状态变化都要记录事件日志和操作人。
- 所有异常中断都必须落到可解释的 `reason_code`，不能只返回“失败”。

## 2. 设备状态机

### 2.1 设备生命周期状态

| 状态 | 含义 | 可转入 | 可转出 |
| --- | --- | --- | --- |
| draft | 已建档未启用 | 新建设备 | inactive / disabled |
| inactive | 已建档待激活 | 调试完成前 | active / disabled |
| active | 可参与业务 | 激活成功 | disabled / scrapped |
| disabled | 停用 | 人工停用 | active / scrapped |
| scrapped | 报废 | 退役 | 无 |

### 2.2 设备运行状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| idle | 在线空闲 | 心跳正常且无活跃会话 | starting / offline / alarm |
| starting | 启动中 | 收到启动命令 | running / alarm / idle |
| running | 运行中 | 启动成功并有活跃会话 | stopping / alarm / offline |
| stopping | 停止中 | 收到停止命令或保护链触发 | idle / alarm |
| alarm | 告警中 | 运行异常、阈值超限、执行失败 | idle / disabled |
| offline | 离线 | 超过离线阈值未心跳 | idle / disabled |

约束：

- 生命周期状态与运行状态分离存储。
- `disabled` 生命周期下不能进入 `starting` 或 `running`。

## 3. 运行会话状态机

### 3.1 主状态流

| 状态 | 含义 | 典型触发 |
| --- | --- | --- |
| pending_check | 已扫码，待后端校验 | 创建扫码票据 |
| pending_start | 校验通过，待发起启动 | 生成 allow 决策 |
| starting | 已下发启动命令 | 点击开始或自动启动 |
| running | 已进入运行但未满足计费阈值 | 泵/阀启动成功 |
| billing | 满足计费阈值，进入计费 | 功率/流量达到阈值 |
| stopping | 停止中 | 用户结束、超时、保护链触发 |
| ended | 正常结束 | 命令执行成功且保护链完成 |
| failed | 异常结束 | 启动失败、执行失败、保护失败 |

### 3.2 转移动作与守卫条件

| 从状态 | 动作 | 守卫条件 | 到状态 |
| --- | --- | --- | --- |
| pending_check | evaluate_start | 扫码目标存在且用户有权限 | pending_start / failed |
| pending_start | dispatch_start_commands | 运行决策为 allow | starting |
| starting | receive_running_ack | 泵、阀达到运行条件 | running |
| starting | startup_timeout | 超过启动超时 | failed |
| running | reach_billing_threshold | 达到功率/流量阈值 | billing |
| running | stop_request | 用户主动结束 | stopping |
| billing | stop_request | 用户主动结束 | stopping |
| billing | overtime_protect | 超过最大运行时长 | stopping |
| stopping | stop_chain_finished | 泵阀保护链完成 | ended |
| stopping | stop_chain_failed | 保护链执行失败 | failed |

### 3.3 失败原因必须标准化

| reason_code | 含义 |
| --- | --- |
| TARGET_NOT_FOUND | 扫码目标不存在 |
| USER_NOT_IN_SCOPE | 用户无数据范围权限 |
| RELATION_NOT_CONFIGURED | 泵阀关系未配置 |
| POLICY_NOT_EFFECTIVE | 井级策略未生效 |
| CONCURRENCY_LIMIT_REACHED | 已达到并发上限 |
| DEVICE_OFFLINE | 关键设备离线 |
| STARTUP_TIMEOUT | 启动超时 |
| BILLING_THRESHOLD_NOT_REACHED | 未达到计费阈值 |
| SAFETY_PROTECTION_TRIGGERED | 触发安全保护 |
| STOP_CHAIN_FAILED | 停机保护链失败 |

## 4. 运行容器状态机

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| pending | 已创建但尚未承载活跃会话 | 首个会话进入前 | active / failed |
| active | 有活跃会话，资源占用中 | 启动成功 | protection_stopping / closed / failed |
| protection_stopping | 正在执行停机保护链 | 最后一个会话结束或保护触发 | closed / failed |
| closed | 已正常关闭 | 停机保护链完成 | 无 |
| failed | 异常关闭 | 保护链失败 | 无 |

约束：

- 同一机井同一时刻只能有一个 `active` 容器。
- 最后一个阀结束后，不允许直接改为 `closed`，必须经过 `protection_stopping`。

## 5. 订单状态机

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| created | 已创建待计费 | 会话建立且进入运行链 | charging / closed |
| charging | 计费中 | 会话进入 billing | pending_settlement / exception_review |
| pending_settlement | 已结束待结算 | 会话正常结束 | settled / exception_review |
| settled | 已结算 | 账务确认 | closed |
| exception_review | 异常待复核 | 金额异常、计费异常、会话异常 | settled / closed |
| closed | 已关闭 | 作废或结清完成 | 无 |

约束：

- `created` 到 `charging` 只能由后端根据阈值判断。
- `amount` 和 `pricing_snapshot_json` 在 `pending_settlement` 后冻结。

## 6. 告警状态机

| 状态 | 含义 | 动作 |
| --- | --- | --- |
| open | 新告警 | 创建后等待处理 |
| acknowledged | 已确认 | 人工确认已知悉 |
| processing | 处理中 | 已创建工单或已现场处理 |
| resolved | 已解除 | 根因已消除 |
| closed | 已关闭 | 复核完成或无需继续跟踪 |

触发说明：

- 设备离线、阀超时、泵启动失败、连续失败、异常计费都可触发告警。
- `critical` 告警可自动创建工单并推动状态到 `processing`。

## 7. 工单状态机

| 状态 | 含义 | 进入动作 | 退出动作 |
| --- | --- | --- | --- |
| pending_accept | 待受理 | 自动建单或人工建单 | assigned / closed |
| assigned | 已派单 | 指定处理人 | accepted / closed |
| accepted | 已接单 | 运维人员接单 | processing |
| processing | 处理中 | 开始现场处理 | pending_review / closed |
| pending_review | 待复核 | 提交处理结果 | completed / processing |
| completed | 已完成 | 复核通过 | closed |
| closed | 已关闭 | 作废或归档 | 无 |

约束：

- 从告警流转来的工单，必须能回溯到 `alarm_id`、`session_id`、`device_id`。
- `/m` 端只允许执行自己有权限的转移动作。

## 8. UAT 执行状态机

| 状态 | 含义 | 触发 |
| --- | --- | --- |
| todo | 待执行 | 创建验收任务 |
| running | 进行中 | 验收人开始执行 |
| passed | 已通过 | 所有断言通过 |
| blocked | 有阻塞 | 发现阻断问题 |
| retest | 待复验 | 修复完成后重新验收 |
| closed | 已关闭 | 最终归档 |

约束：

- `blocked` 必须填写阻塞原因和关联缺陷。
- `retest` 只能从 `blocked` 转入。

## 9. AI 会话状态机

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| created | 已创建 | 首次进入帮助或 AI 页 | chatting / closed |
| chatting | 对话中 | 正常问答 | pending_handoff / closed |
| pending_handoff | 待转人工 | 触发高风险或复杂问题 | handed_off / chatting |
| handed_off | 已转人工 | 已创建人工单据 | closed |
| closed | 已关闭 | 会话结束 | 无 |

约束：

- 任意涉及设备直接控制、支付争议、安全风险的意图，都不允许继续停留在纯 `chatting` 状态。

## 10. 建议的状态事件日志

每个状态机统一输出如下日志字段：

| 字段 | 说明 |
| --- | --- |
| entity_type | 会话、订单、工单等对象类型 |
| entity_id | 对象主键 |
| from_status | 原状态 |
| to_status | 目标状态 |
| action_code | 触发动作 |
| operator_id | 操作人或系统 |
| reason_code | 原因码 |
| snapshot_json | 关键上下文 |
| created_at | 事件时间 |
