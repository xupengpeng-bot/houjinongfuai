# API 草案文档

## 1. 设计约定

- API 版本前缀统一为 `/api/v1`。
- 管理后台、移动端、农户端共享同一业务中台，按权限控制接口可见性。
- 所有写接口必须返回标准结果结构，不允许前端通过 HTTP 200 自行判断业务成功。

标准响应：

```json
{
  "request_id": "01HQ...",
  "code": "OK",
  "message": "success",
  "data": {},
  "meta": {}
}
```

标准错误：

```json
{
  "request_id": "01HQ...",
  "code": "CONCURRENCY_LIMIT_REACHED",
  "message": "当前机井已达到并发上限",
  "data": {
    "blocking_reasons": [
      {
        "reason_code": "CONCURRENCY_LIMIT_REACHED",
        "reason_text": "当前已有 3 个活跃阀门会话",
        "source": "well_runtime_policy"
      }
    ]
  }
}
```

## 2. 统一决策响应模型

涉及启动、停止、计费预览、AI 受控动作时，统一返回：

```json
{
  "decision_id": "dec_xxx",
  "result": "allow",
  "blocking_reasons": [],
  "available_actions": [
    {
      "action_code": "START_SESSION",
      "label": "开始用水",
      "requires_confirm": true
    }
  ],
  "effective_rule_source": {
    "policy_id": "pol_xxx",
    "relation_id": "rel_xxx",
    "priority_chain": [
      "well_runtime_policy",
      "pump_valve_relation",
      "interaction_policy",
      "scenario_template",
      "device_type_default"
    ]
  },
  "price_preview": {
    "billing_mode": "duration",
    "unit_price": 1.8,
    "unit_type": "minute",
    "currency": "CNY"
  }
}
```

规则：

- 前端按钮状态由 `result` 和 `available_actions` 决定。
- 阻断文案由 `blocking_reasons` 决定。
- 价格展示由 `price_preview` 决定。

## 3. 身份与权限接口

### 3.1 登录与当前用户

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/auth/login` | 登录 |
| POST | `/auth/logout` | 登出 |
| GET | `/auth/me` | 获取当前用户、角色、数据范围 |
| GET | `/auth/menus` | 获取当前用户菜单与按钮权限 |

`GET /auth/me` 返回重点字段：

```json
{
  "user_id": "usr_xxx",
  "user_type": "project_manager",
  "roles": ["project_manager"],
  "data_scopes": [
    {
      "scope_type": "region",
      "scope_ref_id": "reg_xxx"
    }
  ]
}
```

### 3.2 用户、角色、权限

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/system/users` | 用户列表 |
| POST | `/system/users` | 创建用户 |
| GET | `/system/users/{id}` | 用户详情 |
| PATCH | `/system/users/{id}` | 更新用户 |
| POST | `/system/users/{id}/roles` | 分配角色 |
| GET | `/system/roles` | 角色列表 |
| POST | `/system/roles` | 创建角色 |
| GET | `/system/permissions` | 权限枚举 |
| POST | `/system/data-scopes` | 配置数据范围 |

## 4. 区域与对象主数据接口

### 4.1 区域管理

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/regions/tree` | 获取区域树 |
| GET | `/regions` | 区域列表 |
| POST | `/regions` | 创建区域 |
| GET | `/regions/{id}` | 区域详情 |
| PATCH | `/regions/{id}` | 更新区域 |
| POST | `/regions/{id}/enable` | 启用区域 |
| POST | `/regions/{id}/disable` | 停用区域 |

### 4.2 设备类型

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/device-types` | 设备类型列表 |
| POST | `/device-types` | 创建设备类型 |
| GET | `/device-types/{id}` | 设备类型详情 |
| PATCH | `/device-types/{id}` | 更新设备类型 |
| POST | `/device-types/{id}/activate` | 激活 |
| POST | `/device-types/{id}/archive` | 归档 |

### 4.3 设备台账

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/devices` | 设备列表 |
| POST | `/devices` | 创建设备 |
| GET | `/devices/{id}` | 设备详情 |
| PATCH | `/devices/{id}` | 更新设备 |
| POST | `/devices/{id}/activate` | 激活设备 |
| POST | `/devices/{id}/disable` | 停用设备 |
| GET | `/devices/{id}/telemetry` | 最近遥测 |
| GET | `/devices/{id}/events` | 设备事件流 |

## 5. 专业设备接口

### 5.1 机井 / 泵 / 阀

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/wells` | 机井列表 |
| POST | `/wells` | 创建机井 |
| GET | `/wells/{id}` | 机井详情 |
| PATCH | `/wells/{id}` | 更新机井 |
| GET | `/pumps` | 泵列表 |
| POST | `/pumps` | 创建泵 |
| GET | `/pumps/{id}` | 泵详情 |
| PATCH | `/pumps/{id}` | 更新泵 |
| GET | `/valves` | 阀列表 |
| POST | `/valves` | 创建阀 |
| GET | `/valves/{id}` | 阀详情 |
| PATCH | `/valves/{id}` | 更新阀 |

### 5.2 关系配置

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/pump-valve-relations` | 关系列表 |
| POST | `/pump-valve-relations` | 创建关系 |
| GET | `/pump-valve-relations/{id}` | 关系详情 |
| PATCH | `/pump-valve-relations/{id}` | 更新关系 |
| POST | `/pump-valve-relations/{id}/activate` | 启用关系 |
| POST | `/pump-valve-relations/{id}/deactivate` | 停用关系 |

建议详情响应包含：

```json
{
  "pump_valve_relation_id": "rel_xxx",
  "well": {},
  "pump": {},
  "valve": {},
  "effective_policy_preview": {
    "concurrency_limit": 3,
    "billing_package_id": "pkg_xxx",
    "power_threshold_kw": 5.5
  }
}
```

## 6. 规则配置接口

### 6.1 计费包

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/billing-packages` | 列表 |
| POST | `/billing-packages` | 创建 |
| GET | `/billing-packages/{id}` | 详情 |
| PATCH | `/billing-packages/{id}` | 更新 |
| POST | `/billing-packages/{id}/activate` | 激活 |
| POST | `/billing-packages/{id}/expire` | 失效 |

### 6.2 井级策略

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/well-runtime-policies` | 列表 |
| POST | `/well-runtime-policies` | 创建 |
| GET | `/well-runtime-policies/{id}` | 详情 |
| PATCH | `/well-runtime-policies/{id}` | 更新 |
| POST | `/well-runtime-policies/{id}/activate` | 激活 |
| POST | `/well-runtime-policies/{id}/disable` | 停用 |
| GET | `/well-runtime-policies/{id}/effective-preview` | 生效预览 |

`GET /well-runtime-policies/{id}/effective-preview` 目的：

- 让后台在保存前看到最终生效配置。
- 由后端显式说明哪些值来自井级策略，哪些值来自关系配置或模板兜底。

## 7. 扫码、决策与运行接口

### 7.1 农户扫码入口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/u/scan/resolve` | 解析二维码并返回目标对象 |
| POST | `/u/runtime/start-check` | 启动前校验 |
| POST | `/u/runtime/sessions` | 基于决策创建运行会话 |
| POST | `/u/runtime/sessions/{id}/stop-check` | 停止前校验 |
| POST | `/u/runtime/sessions/{id}/stop` | 结束会话 |
| GET | `/u/runtime/current-session` | 当前活跃会话 |
| GET | `/u/runtime/sessions` | 历史会话列表 |
| GET | `/u/runtime/sessions/{id}` | 会话详情 |

`POST /u/scan/resolve` 请求示例：

```json
{
  "qr_code": "well://xxx?valve=yyy"
}
```

`POST /u/runtime/start-check` 请求示例：

```json
{
  "scan_ticket_id": "scan_xxx",
  "target_type": "valve",
  "target_id": "val_xxx"
}
```

`POST /u/runtime/sessions` 请求示例：

```json
{
  "decision_id": "dec_xxx",
  "confirm_token": "cfm_xxx"
}
```

规则：

- 前端必须先调用 `start-check`，不能直接创建会话。
- `start-check` 返回 deny 时，前端只能展示阻断原因或帮助入口。

### 7.2 管理后台与移动端运行接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/runtime/sessions` | 会话列表 |
| GET | `/runtime/sessions/{id}` | 会话详情 |
| GET | `/runtime/sessions/{id}/commands` | 命令列表 |
| GET | `/runtime/containers` | 运行容器列表 |
| GET | `/runtime/containers/{id}` | 容器详情 |
| POST | `/runtime/manual-tests/start-check` | 运维端手动测试前校验 |
| POST | `/runtime/manual-tests` | 发起现场手动测试 |

## 8. 订单接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/orders` | 订单列表 |
| GET | `/orders/{id}` | 订单详情 |
| GET | `/orders/{id}/pricing` | 计价明细 |
| POST | `/orders/{id}/review` | 异常订单复核 |

农户端接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/u/orders` | 农户订单列表 |
| GET | `/u/orders/{id}` | 农户订单详情 |

## 9. 告警接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/alarms` | 告警列表 |
| GET | `/alarms/{id}` | 告警详情 |
| POST | `/alarms/{id}/acknowledge` | 确认告警 |
| POST | `/alarms/{id}/resolve` | 解除告警 |
| POST | `/alarms/{id}/create-work-order` | 基于告警建单 |

## 10. 工单接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/work-orders` | 工单列表 |
| POST | `/work-orders` | 创建工单 |
| GET | `/work-orders/{id}` | 工单详情 |
| PATCH | `/work-orders/{id}` | 更新工单基础信息 |
| POST | `/work-orders/{id}/assign` | 派单 |
| POST | `/work-orders/{id}/accept` | 接单 |
| POST | `/work-orders/{id}/process` | 提交处理进度 |
| POST | `/work-orders/{id}/review` | 复核 |
| POST | `/work-orders/{id}/close` | 关闭 |

移动端补充：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/m/my/todos` | 我的待办 |
| GET | `/m/my/work-orders` | 我的工单 |
| GET | `/m/my/devices` | 我的设备 |
| POST | `/m/field-actions/quick-test` | 现场快速测试 |

## 11. UAT 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/uat/cases` | 验收项列表 |
| POST | `/uat/cases` | 创建验收项 |
| GET | `/uat/executions` | 验收执行列表 |
| POST | `/uat/executions` | 创建验收执行 |
| POST | `/uat/executions/{id}/start` | 开始执行 |
| POST | `/uat/executions/{id}/pass` | 验收通过 |
| POST | `/uat/executions/{id}/block` | 标记阻塞 |
| POST | `/uat/executions/{id}/retest` | 发起复验 |
| POST | `/uat/executions/{id}/close` | 关闭 |

## 12. AI 会话中台预留接口

### 12.1 农户端帮助入口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/u/ai/conversations` | 创建或续用会话 |
| GET | `/u/ai/conversations/{id}` | 会话详情 |
| GET | `/u/ai/conversations/{id}/messages` | 消息列表 |
| POST | `/u/ai/conversations/{id}/messages` | 发送消息 |
| POST | `/u/ai/conversations/{id}/handoff` | 转人工 / 转工单 |
| GET | `/u/help/faqs` | FAQ 列表 |

`POST /u/ai/conversations/{id}/messages` Phase 1 返回范围：

```json
{
  "conversation_id": "conv_xxx",
  "reply_mode": "faq_or_tool",
  "reply_text": "当前会话正在运行中，如需停止请点击结束用水。",
  "tool_calls": [
    {
      "tool_code": "QUERY_CURRENT_SESSION",
      "result_status": "success"
    }
  ],
  "risk_level": "low",
  "handoff_suggested": false
}
```

规则：

- 只支持 FAQ、查询当前会话、查询订单、提交工单、转人工。
- 若意图命中高风险控制，则返回 `risk_level=high` 和 `handoff_suggested=true`。

### 12.2 渠道绑定预留接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/ai/channel-bindings` | 创建渠道绑定 |
| GET | `/ai/channel-bindings/{id}` | 渠道绑定详情 |

说明：

- Phase 1 仅供数据预留和内部调试，不提供微信/飞书正式接入。

## 13. 错误码建议

| 错误码 | 场景 | 含义 |
| --- | --- | --- |
| OK | 通用 | 成功 |
| VALIDATION_ERROR | 通用 | 参数校验失败 |
| FORBIDDEN | 通用 | 无权限 |
| DATA_SCOPE_DENIED | 通用 | 超出数据范围 |
| TARGET_NOT_FOUND | 扫码/对象 | 目标不存在 |
| DEVICE_OFFLINE | 运行 | 关键设备离线 |
| RELATION_NOT_CONFIGURED | 运行 | 泵阀关系未配置 |
| POLICY_NOT_EFFECTIVE | 运行 | 井级策略未生效 |
| CONCURRENCY_LIMIT_REACHED | 运行 | 已达并发上限 |
| STARTUP_TIMEOUT | 运行 | 启动超时 |
| SAFETY_PROTECTION_TRIGGERED | 运行 | 触发安全保护 |
| ORDER_REVIEW_REQUIRED | 订单 | 订单需人工复核 |
| WORK_ORDER_STATE_INVALID | 工单 | 工单状态流转非法 |
| AI_HIGH_RISK_INTENT | AI | 高风险意图，不允许直接执行 |

## 14. 前后端边界

前端负责：

- 表单录入、状态展示、动作触发、阻断原因展示。
- 根据 `available_actions` 决定按钮显隐和禁用态。
- 根据 `risk_level` 决定是否突出显示帮助或人工入口。

后端负责：

- 规则合并、运行决策、计费阈值判定、并发控制、安全保护链。
- 状态推进、命令投递、计价快照冻结、告警建单。
- AI 工具调用白名单、风险分级、转人工与审计。
