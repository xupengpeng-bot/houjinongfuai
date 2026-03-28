# 核心对象模型文档

## 1. 建模目标

Phase 1 的对象模型必须同时满足四件事：

- 支撑灌溉最小闭环，而不是只服务单页面 CRUD。
- 统一承接 /ops、/m、/u 三端的读写需求。
- 为后续水肥、气象、农机和多渠道 AI 留扩展口，但不提前实现复杂业务。
- 把运行、计费、安全判断收口到后端决策对象，不允许前端自行组合规则。

## 2. 分层对象图

| 层级 | 对象 | 作用 |
| --- | --- | --- |
| 治理层 | Tenant、User、Role、Permission、DataScope | 约束谁能看、谁能配、谁能操作 |
| 空间层 | Region | 定义区域、项目、服务范围和策略作用域 |
| 主数据层 | DeviceType、Device | 定义设备家族、设备实例和默认能力 |
| 专业设备层 | Well、Pump、Valve | 承接 Phase 1 的灌溉主设备对象 |
| 规则层 | BillingPackage、WellRuntimePolicy、InteractionPolicy、ScenarioTemplate | 定义计费、限流、计费阈值、安全阈值和交互推荐参数 |
| 关系层 | TopologyRelation、PumpValveRelation | 定义供给、归属、控制和共享资源关系 |
| 执行层 | ScanTicket、RuntimeDecision、RuntimeSession、CommandDispatch、RuntimeContainer | 承接扫码、校验、命令、运行和停机保护 |
| 事件层 | IrrigationOrder、AlarmEvent、WorkOrder、UATCase、UATExecution | 承接业务结果、异常和验收闭环 |
| AI 预留层 | AiConversation、AiMessage、ChannelBinding、ConversationContextSnapshot、AiHandoff | 预留统一会话中台和人工协同入口 |

## 3. 核心聚合与边界

### 3.1 治理聚合

#### Tenant

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| tenant_id | uuid | 租户主键 |
| tenant_code | varchar(64) | 租户编码 |
| tenant_name | varchar(128) | 租户名称 |
| status | enum | active / disabled |

说明：

- 如果当前项目先单租户运行，也保留 `tenant_id` 字段，避免后续迁移返工。

#### User

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| user_id | uuid | 用户主键 |
| tenant_id | uuid | 所属租户 |
| user_type | enum | platform_admin / project_manager / finance / operator / farmer / service_agent |
| display_name | varchar(64) | 显示名 |
| mobile | varchar(32) | 手机号 |
| status | enum | active / disabled / locked |

#### Role / Permission / DataScope

| 对象 | 核心字段 | 说明 |
| --- | --- | --- |
| Role | role_code、role_name、role_type | 角色定义 |
| Permission | permission_code、resource_code、action_code | 细粒度操作权限 |
| DataScope | scope_type、scope_ref_id、scope_rule_json | 区域、项目、设备范围授权 |

说明：

- 数据范围必须显式建模，不能只靠前端过滤。
- /m 与 /u 的可见对象同样经过角色和数据范围控制。

### 3.2 空间聚合

#### Region

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| region_id | uuid | 区域主键 |
| tenant_id | uuid | 所属租户 |
| parent_id | uuid | 父区域 |
| region_code | varchar(64) | 区域编码 |
| region_name | varchar(128) | 区域名称 |
| region_type | enum | project / service_area / village / plot_group / plot |
| full_path | varchar(512) | 树路径 |
| manager_user_id | uuid | 区域负责人 |
| status | enum | active / disabled |

说明：

- Region 同时承担对象归属、权限范围、策略作用域、统计维度四种职责。
- Phase 1 可先把地块作为 `plot` 类型区域，不单独拆表。

### 3.3 设备主数据聚合

#### DeviceType

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| device_type_id | uuid | 主键 |
| type_code | varchar(64) | 类型编码 |
| type_name | varchar(128) | 类型名称 |
| family | enum | well / pump / valve / gateway / sensor / reserved |
| capability_json | jsonb | 支持的标准动作、遥测项、事件 |
| default_config_json | jsonb | 设备类型默认参数 |
| form_schema_json | jsonb | 配置表单 schema |
| status | enum | draft / active / archived |

说明：

- 设备类型只提供默认值和动态页面能力，不是运行时最终决策源。

#### Device

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| device_id | uuid | 主键 |
| tenant_id | uuid | 所属租户 |
| device_type_id | uuid | 类型 |
| region_id | uuid | 所属区域 |
| device_code | varchar(64) | 设备编码 |
| device_name | varchar(128) | 设备名称 |
| serial_no | varchar(128) | 出厂序列号 |
| protocol_type | varchar(32) | 接入协议 |
| online_state | enum | unknown / online / offline |
| lifecycle_state | enum | draft / inactive / active / disabled / scrapped |
| runtime_state | enum | idle / starting / running / stopping / alarm |
| install_time | timestamp | 安装时间 |
| last_heartbeat_at | timestamp | 最后心跳 |

说明：

- 所有专业设备都必须先在 `Device` 注册，再由专业子表承接业务字段。

### 3.4 专业设备聚合

#### Well

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| well_id | uuid | 主键 |
| device_id | uuid | 对应 Device |
| well_code | varchar(64) | 井编码 |
| water_source_type | enum | groundwater / reservoir / river / reserved |
| rated_flow | decimal(12,2) | 额定流量 |
| rated_pressure | decimal(12,2) | 额定压力 |
| max_concurrency | int | 最大并发阀数 |
| safety_profile_json | jsonb | 井级安全参数 |

#### Pump

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| pump_id | uuid | 主键 |
| device_id | uuid | 对应 Device |
| well_id | uuid | 所属机井 |
| pump_code | varchar(64) | 泵编码 |
| rated_power_kw | decimal(10,2) | 额定功率 |
| startup_timeout_sec | int | 启动超时 |
| stop_timeout_sec | int | 停机超时 |
| power_meter_device_id | uuid | 功率采集设备，可空 |

#### Valve

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| valve_id | uuid | 主键 |
| device_id | uuid | 对应 Device |
| well_id | uuid | 默认归属机井 |
| valve_code | varchar(64) | 阀编码 |
| valve_kind | enum | electromagnetic / motorized / outlet |
| open_timeout_sec | int | 开阀超时 |
| close_timeout_sec | int | 关阀超时 |
| farmland_region_id | uuid | 对应地块区域，可空 |

说明：

- `Well`、`Pump`、`Valve` 保留独立业务表，是为了提升 Phase 1 可开发性。
- 后续水肥机和气象设备可沿用同样模式扩展。

### 3.5 规则聚合

#### BillingPackage

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| billing_package_id | uuid | 主键 |
| package_code | varchar(64) | 计费包编码 |
| package_name | varchar(128) | 计费包名称 |
| billing_mode | enum | duration / volume / flat / free |
| unit_price | decimal(12,2) | 单价 |
| unit_type | enum | minute / cubic_meter / session |
| min_charge_amount | decimal(12,2) | 最低收费 |
| scope_type | enum | tenant / region / well / relation |
| scope_ref_id | uuid | 作用对象 |
| status | enum | draft / active / expired / disabled |

#### WellRuntimePolicy

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| policy_id | uuid | 主键 |
| well_id | uuid | 作用机井 |
| billing_package_id | uuid | 绑定计费包 |
| power_threshold_kw | decimal(10,2) | 达到该功率后开始计费 |
| min_run_seconds | int | 最短运行时长 |
| max_run_seconds | int | 最长运行时长 |
| concurrency_limit | int | 并发阀门上限 |
| stop_protection_mode | enum | last_valve_then_stop_pump / stop_pump_then_close_valve |
| safety_rule_json | jsonb | 停机保护、连续失败等参数 |
| status | enum | draft / active / disabled |

#### InteractionPolicy

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| interaction_policy_id | uuid | 主键 |
| target_type | enum | farmer_app / operator_mobile / admin_console |
| scene_code | varchar(64) | 交互场景 |
| confirm_mode | enum | none / single_confirm / secondary_confirm |
| prompt_json | jsonb | 前端提示文案和引导配置 |
| status | enum | active / disabled |

#### ScenarioTemplate

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| template_id | uuid | 主键 |
| template_code | varchar(64) | 模板编码 |
| template_name | varchar(128) | 模板名称 |
| target_family | varchar(32) | 目标设备家族 |
| template_config_json | jsonb | 推荐参数 |
| status | enum | draft / active / archived |

固定优先级：

1. 井级策略 `WellRuntimePolicy`
2. 关系配置 `PumpValveRelation` / `TopologyRelation`
3. 交互策略 `InteractionPolicy`
4. 场景模板 `ScenarioTemplate`
5. 设备类型默认值 `DeviceType.default_config_json`

说明：

- 后端必须返回 `effective_rule_snapshot` 和 `effective_rule_source`，前端只展示，不自行叠加。

### 3.6 关系聚合

#### TopologyRelation

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| relation_id | uuid | 主键 |
| source_type | enum | region / device / well / pump / valve |
| source_id | uuid | 源对象 |
| target_type | enum | region / device / well / pump / valve |
| target_id | uuid | 目标对象 |
| relation_type | enum | ownership / supply / control / orchestration / mutual_exclusion |
| priority | int | 关系优先级 |
| status | enum | active / inactive |
| config_json | jsonb | 关系扩展配置 |

#### PumpValveRelation

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| pump_valve_relation_id | uuid | 主键 |
| well_id | uuid | 机井 |
| pump_id | uuid | 泵 |
| valve_id | uuid | 阀 |
| relation_role | enum | primary / backup / forbidden |
| billing_inherit_mode | enum | well_policy / relation_override |
| relation_config_json | jsonb | 并发、顺序、保护链配置 |
| status | enum | active / inactive |

说明：

- `PumpValveRelation` 是 V1 的强业务关系表。
- `TopologyRelation` 用于承接更通用的后续扩展，不替代 V1 的显式关系管理。

### 3.7 执行聚合

#### ScanTicket

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| scan_ticket_id | uuid | 主键 |
| scene_code | varchar(64) | 扫码场景 |
| qr_code | varchar(256) | 原始二维码值 |
| parsed_target_type | enum | valve / well / session_entry / help_entry |
| parsed_target_id | uuid | 识别出的对象 |
| user_id | uuid | 扫码用户 |
| expired_at | timestamp | 过期时间 |

#### RuntimeDecision

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| decision_id | uuid | 主键 |
| scene_code | varchar(64) | start_check / stop_check / resume_check |
| user_id | uuid | 触发用户 |
| target_type | enum | valve / well / session |
| target_id | uuid | 触发目标 |
| decision_result | enum | allow / deny / manual_review |
| blocking_reasons_json | jsonb | 阻断原因 |
| available_actions_json | jsonb | 可执行动作 |
| effective_rule_snapshot_json | jsonb | 生效规则快照 |
| price_preview_json | jsonb | 计费预估 |
| decision_expires_at | timestamp | 决策有效期 |

说明：

- `RuntimeDecision` 是 Phase 1 的关键对象，承接后端统一裁决。
- 农户端和运维端都不能绕过它直接下发高风险动作。

#### RuntimeSession

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| session_id | uuid | 主键 |
| session_no | varchar(64) | 会话编号 |
| runtime_container_id | uuid | 所属运行容器，可空 |
| user_id | uuid | 发起人 |
| well_id | uuid | 所属机井 |
| pump_id | uuid | 使用泵 |
| valve_id | uuid | 使用阀 |
| source_scan_ticket_id | uuid | 来源扫码票据 |
| source_decision_id | uuid | 来源决策 |
| status | enum | pending_check / pending_start / starting / running / billing / stopping / ended / failed |
| billing_started_at | timestamp | 计费开始时间 |
| started_at | timestamp | 启动时间 |
| ended_at | timestamp | 结束时间 |
| end_reason_code | varchar(64) | 结束原因 |
| telemetry_snapshot_json | jsonb | 关键遥测快照 |

#### CommandDispatch

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| command_id | uuid | 主键 |
| session_id | uuid | 所属会话 |
| target_device_id | uuid | 目标设备 |
| command_code | enum | start_pump / stop_pump / open_valve / close_valve / query_status |
| dispatch_status | enum | created / sent / acked / timeout / failed / cancelled |
| request_payload_json | jsonb | 请求体 |
| response_payload_json | jsonb | 响应体 |
| sent_at | timestamp | 下发时间 |
| acked_at | timestamp | 回执时间 |

#### RuntimeContainer

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| runtime_container_id | uuid | 主键 |
| well_id | uuid | 所属机井 |
| status | enum | pending / active / protection_stopping / closed / failed |
| active_session_count | int | 活跃会话数 |
| shared_resource_snapshot_json | jsonb | 当前资源占用 |
| protection_state_json | jsonb | 停机保护链状态 |

说明：

- 一井多阀共享泵场景必须通过 `RuntimeContainer` 管理。
- 最后一个阀结束时是否停泵、是否回查全井阀状态，由后端保护链裁决。

### 3.8 事件聚合

#### IrrigationOrder

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| order_id | uuid | 主键 |
| order_no | varchar(64) | 订单号 |
| session_id | uuid | 来源会话 |
| user_id | uuid | 用户 |
| billing_package_id | uuid | 计费包 |
| status | enum | created / charging / pending_settlement / settled / exception_review / closed |
| charge_duration_sec | int | 计费时长 |
| charge_volume | decimal(12,2) | 计费流量 |
| amount | decimal(12,2) | 金额 |
| settlement_status | enum | unpaid / paid / waived / reconciled |
| pricing_snapshot_json | jsonb | 计价快照 |

#### AlarmEvent

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| alarm_id | uuid | 主键 |
| alarm_code | varchar(64) | 告警编码 |
| source_type | enum | device / session / order / ai |
| source_id | uuid | 来源对象 |
| severity | enum | info / warning / major / critical |
| status | enum | open / acknowledged / processing / resolved / closed |
| trigger_reason_json | jsonb | 触发原因 |
| auto_create_work_order | boolean | 是否自动建单 |

#### WorkOrder

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| work_order_id | uuid | 主键 |
| work_order_no | varchar(64) | 工单号 |
| source_alarm_id | uuid | 来源告警，可空 |
| source_session_id | uuid | 来源会话，可空 |
| work_order_type | enum | fault / inspection / maintenance / uat_recheck / ai_handoff |
| status | enum | pending_accept / assigned / accepted / processing / pending_review / completed / closed |
| assignee_user_id | uuid | 处理人 |
| sla_deadline_at | timestamp | SLA 截止时间 |
| result_json | jsonb | 处理结果 |

#### UATCase / UATExecution

| 对象 | 核心字段 | 说明 |
| --- | --- | --- |
| UATCase | case_code、role_type、scenario_name、expected_result | 验收模板 |
| UATExecution | execution_no、case_id、executor_user_id、status、block_reason_json | 验收执行记录 |

### 3.9 AI 预留聚合

#### AiConversation

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| conversation_id | uuid | 主键 |
| tenant_id | uuid | 所属租户 |
| channel | enum | app / wechat / feishu / reserved |
| user_id | uuid | 平台用户 |
| status | enum | created / chatting / pending_handoff / handed_off / closed |
| topic | varchar(128) | 会话主题 |
| latest_intent | varchar(64) | 最新意图 |

#### ChannelBinding

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| binding_id | uuid | 主键 |
| channel | enum | app / wechat / feishu |
| external_user_id | varchar(128) | 外部渠道用户标识 |
| platform_user_id | uuid | 平台用户 |
| binding_status | enum | active / unbound |

#### ConversationContextSnapshot

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| snapshot_id | uuid | 主键 |
| conversation_id | uuid | 所属会话 |
| current_session_id | uuid | 当前运行会话，可空 |
| last_order_id | uuid | 最近订单，可空 |
| bound_device_id | uuid | 关联设备，可空 |
| region_id | uuid | 区域上下文 |
| snapshot_json | jsonb | 聚合上下文数据 |

#### AiHandoff

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| handoff_id | uuid | 主键 |
| conversation_id | uuid | 来源会话 |
| handoff_type | enum | manual_service / work_order |
| status | enum | pending / accepted / completed / closed |
| target_work_order_id | uuid | 转出的工单 |
| handoff_reason_json | jsonb | 转人工原因 |

说明：

- Phase 1 只预留中台对象和查询/转人工接口。
- 不实现多渠道正式收发，但数据模型必须统一。

## 4. 关键领域约束

### 4.1 统一决策约束

- 任意启动前，必须先创建 `RuntimeDecision`。
- 任意前端按钮只依据 `available_actions` 决定是否可点。
- 任意价格展示只依据 `price_preview_json` 和订单快照，不允许前端本地计算。

### 4.2 关系与规则约束

- `WellRuntimePolicy` 必须绑定到 `Well`，不能跳过井直接对阀写最终策略。
- `PumpValveRelation` 必须显式存在，阀门才允许参与灌溉运行。
- `relation_role=forbidden` 时，后端必须返回阻断原因，前端不得隐藏。

### 4.3 AI 约束

- AI 仅允许查询会话、查询订单、提交工单、转人工、查询 FAQ。
- AI 不直接触发泵、阀启停，不直接修改计费策略。
- AI 的任一业务调用都要有审计记录。

## 5. Phase 1 必打通的聚合链

1. Region -> DeviceType -> Device -> Well/Pump/Valve
2. BillingPackage -> WellRuntimePolicy -> PumpValveRelation
3. ScanTicket -> RuntimeDecision -> RuntimeSession -> CommandDispatch -> RuntimeContainer
4. RuntimeSession -> IrrigationOrder
5. RuntimeSession / Device -> AlarmEvent -> WorkOrder -> UATExecution
6. Farmer / Operator -> AiConversation -> AiHandoff
