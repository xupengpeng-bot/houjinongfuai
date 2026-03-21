# 数据表结构草案

## 1. 建表原则

- 全部业务表默认带 `tenant_id`、`created_at`、`created_by`、`updated_at`、`updated_by`、`deleted_at`。
- 状态字段使用稳定枚举值，避免把状态塞进 JSON。
- 涉及运行、计费、AI 上下文的快照保存在 `jsonb`，但关键过滤字段必须结构化。
- 所有重要编号都保留业务编号字段，如 `session_no`、`order_no`、`work_order_no`。

## 2. 治理与权限表

### 2.1 `tenant`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_code | varchar(64) | unique |
| tenant_name | varchar(128) | not null |
| status | varchar(16) | idx |

### 2.2 `sys_user`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| user_type | varchar(32) | idx |
| display_name | varchar(64) | not null |
| mobile | varchar(32) | idx |
| status | varchar(16) | idx |

索引建议：

- `uk_sys_user_tenant_mobile (tenant_id, mobile)`

### 2.3 `sys_role`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| role_code | varchar(64) | unique per tenant |
| role_name | varchar(64) | not null |
| role_type | varchar(32) | idx |
| status | varchar(16) | idx |

### 2.4 `sys_permission`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| permission_code | varchar(128) | unique |
| resource_code | varchar(64) | idx |
| action_code | varchar(64) | idx |

### 2.5 `sys_user_role`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| user_id | uuid | idx |
| role_id | uuid | idx |

### 2.6 `sys_role_permission`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| role_id | uuid | idx |
| permission_id | uuid | idx |

### 2.7 `sys_data_scope`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| role_id | uuid | idx |
| scope_type | varchar(32) | idx |
| scope_ref_id | uuid | idx |
| scope_rule_json | jsonb |  |

## 3. 区域与对象主数据表

### 3.1 `region`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| parent_id | uuid | idx |
| region_code | varchar(64) | unique per tenant |
| region_name | varchar(128) | not null |
| region_type | varchar(32) | idx |
| full_path | varchar(512) | idx |
| manager_user_id | uuid | idx |
| status | varchar(16) | idx |

### 3.2 `device_type`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| type_code | varchar(64) | unique per tenant |
| type_name | varchar(128) | not null |
| family | varchar(32) | idx |
| capability_json | jsonb |  |
| default_config_json | jsonb |  |
| form_schema_json | jsonb |  |
| status | varchar(16) | idx |

### 3.3 `device`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| device_type_id | uuid | fk |
| region_id | uuid | idx |
| device_code | varchar(64) | unique per tenant |
| device_name | varchar(128) | not null |
| serial_no | varchar(128) | idx |
| protocol_type | varchar(32) | idx |
| online_state | varchar(16) | idx |
| lifecycle_state | varchar(16) | idx |
| runtime_state | varchar(16) | idx |
| install_time | timestamp |  |
| last_heartbeat_at | timestamp | idx |
| ext_json | jsonb |  |

索引建议：

- `idx_device_tenant_region_state (tenant_id, region_id, lifecycle_state, runtime_state)`
- `idx_device_tenant_type (tenant_id, device_type_id)`

## 4. 专业设备表

### 4.1 `well`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| device_id | uuid | fk, unique |
| well_code | varchar(64) | unique per tenant |
| water_source_type | varchar(32) | idx |
| rated_flow | decimal(12,2) |  |
| rated_pressure | decimal(12,2) |  |
| max_concurrency | int |  |
| safety_profile_json | jsonb |  |

### 4.2 `pump`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| device_id | uuid | fk, unique |
| well_id | uuid | idx |
| pump_code | varchar(64) | unique per tenant |
| rated_power_kw | decimal(10,2) |  |
| startup_timeout_sec | int |  |
| stop_timeout_sec | int |  |
| power_meter_device_id | uuid | idx |

### 4.3 `valve`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| device_id | uuid | fk, unique |
| well_id | uuid | idx |
| valve_code | varchar(64) | unique per tenant |
| valve_kind | varchar(32) | idx |
| open_timeout_sec | int |  |
| close_timeout_sec | int |  |
| farmland_region_id | uuid | idx |

## 5. 规则与关系表

### 5.1 `billing_package`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| package_code | varchar(64) | unique per tenant |
| package_name | varchar(128) | not null |
| billing_mode | varchar(32) | idx |
| unit_price | decimal(12,2) |  |
| unit_type | varchar(32) | idx |
| min_charge_amount | decimal(12,2) |  |
| scope_type | varchar(32) | idx |
| scope_ref_id | uuid | idx |
| status | varchar(16) | idx |

### 5.2 `well_runtime_policy`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| well_id | uuid | idx |
| billing_package_id | uuid | idx |
| power_threshold_kw | decimal(10,2) |  |
| min_run_seconds | int |  |
| max_run_seconds | int |  |
| concurrency_limit | int |  |
| stop_protection_mode | varchar(32) |  |
| safety_rule_json | jsonb |  |
| status | varchar(16) | idx |
| effective_from | timestamp | idx |
| effective_to | timestamp | idx |

索引建议：

- `idx_policy_tenant_well_status (tenant_id, well_id, status)`

### 5.3 `interaction_policy`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| target_type | varchar(32) | idx |
| scene_code | varchar(64) | idx |
| confirm_mode | varchar(32) |  |
| prompt_json | jsonb |  |
| status | varchar(16) | idx |

### 5.4 `scenario_template`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| template_code | varchar(64) | unique per tenant |
| template_name | varchar(128) | not null |
| target_family | varchar(32) | idx |
| template_config_json | jsonb |  |
| status | varchar(16) | idx |

### 5.5 `topology_relation`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| source_type | varchar(32) | idx |
| source_id | uuid | idx |
| target_type | varchar(32) | idx |
| target_id | uuid | idx |
| relation_type | varchar(32) | idx |
| priority | int |  |
| status | varchar(16) | idx |
| config_json | jsonb |  |

索引建议：

- `idx_relation_source (tenant_id, source_type, source_id, relation_type, status)`
- `idx_relation_target (tenant_id, target_type, target_id, relation_type, status)`

### 5.6 `pump_valve_relation`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| well_id | uuid | idx |
| pump_id | uuid | idx |
| valve_id | uuid | idx |
| relation_role | varchar(16) | idx |
| billing_inherit_mode | varchar(32) |  |
| relation_config_json | jsonb |  |
| status | varchar(16) | idx |

约束建议：

- `uk_pump_valve_relation_active (tenant_id, well_id, pump_id, valve_id)`

## 6. 执行与运行表

### 6.1 `scan_ticket`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| user_id | uuid | idx |
| scene_code | varchar(64) | idx |
| qr_code | varchar(256) | idx |
| parsed_target_type | varchar(32) | idx |
| parsed_target_id | uuid | idx |
| expired_at | timestamp | idx |
| status | varchar(16) | idx |

### 6.2 `runtime_decision`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| user_id | uuid | idx |
| scene_code | varchar(64) | idx |
| target_type | varchar(32) | idx |
| target_id | uuid | idx |
| decision_result | varchar(16) | idx |
| blocking_reasons_json | jsonb |  |
| available_actions_json | jsonb |  |
| effective_rule_snapshot_json | jsonb |  |
| price_preview_json | jsonb |  |
| decision_expires_at | timestamp | idx |

索引建议：

- `idx_runtime_decision_target (tenant_id, target_type, target_id, scene_code, created_at)`

### 6.3 `runtime_container`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| well_id | uuid | idx |
| status | varchar(32) | idx |
| active_session_count | int |  |
| shared_resource_snapshot_json | jsonb |  |
| protection_state_json | jsonb |  |

### 6.4 `runtime_session`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| session_no | varchar(64) | unique per tenant |
| runtime_container_id | uuid | idx |
| source_scan_ticket_id | uuid | idx |
| source_decision_id | uuid | idx |
| user_id | uuid | idx |
| well_id | uuid | idx |
| pump_id | uuid | idx |
| valve_id | uuid | idx |
| status | varchar(32) | idx |
| billing_started_at | timestamp | idx |
| started_at | timestamp | idx |
| ended_at | timestamp | idx |
| end_reason_code | varchar(64) | idx |
| telemetry_snapshot_json | jsonb |  |

索引建议：

- `idx_runtime_session_user_status (tenant_id, user_id, status, created_at desc)`
- `idx_runtime_session_well_status (tenant_id, well_id, status, created_at desc)`

### 6.5 `command_dispatch`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| session_id | uuid | idx |
| target_device_id | uuid | idx |
| command_code | varchar(32) | idx |
| dispatch_status | varchar(16) | idx |
| request_payload_json | jsonb |  |
| response_payload_json | jsonb |  |
| sent_at | timestamp | idx |
| acked_at | timestamp | idx |

### 6.6 `session_status_log`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| session_id | uuid | idx |
| from_status | varchar(32) |  |
| to_status | varchar(32) | idx |
| action_code | varchar(64) | idx |
| reason_code | varchar(64) | idx |
| snapshot_json | jsonb |  |

## 7. 事件闭环表

### 7.1 `irrigation_order`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| order_no | varchar(64) | unique per tenant |
| session_id | uuid | idx |
| user_id | uuid | idx |
| billing_package_id | uuid | idx |
| status | varchar(32) | idx |
| settlement_status | varchar(16) | idx |
| charge_duration_sec | int |  |
| charge_volume | decimal(12,2) |  |
| amount | decimal(12,2) |  |
| pricing_snapshot_json | jsonb |  |

### 7.2 `alarm_event`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| alarm_code | varchar(64) | idx |
| source_type | varchar(32) | idx |
| source_id | uuid | idx |
| device_id | uuid | idx |
| session_id | uuid | idx |
| severity | varchar(16) | idx |
| status | varchar(16) | idx |
| trigger_reason_json | jsonb |  |
| auto_create_work_order | boolean |  |

### 7.3 `work_order`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| work_order_no | varchar(64) | unique per tenant |
| source_alarm_id | uuid | idx |
| source_session_id | uuid | idx |
| device_id | uuid | idx |
| work_order_type | varchar(32) | idx |
| status | varchar(32) | idx |
| assignee_user_id | uuid | idx |
| sla_deadline_at | timestamp | idx |
| result_json | jsonb |  |

### 7.4 `work_order_action_log`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| work_order_id | uuid | idx |
| action_code | varchar(64) | idx |
| from_status | varchar(32) |  |
| to_status | varchar(32) | idx |
| operator_id | uuid | idx |
| remark | text |  |
| attachment_json | jsonb |  |

### 7.5 `uat_case`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| case_code | varchar(64) | unique per tenant |
| role_type | varchar(32) | idx |
| scenario_name | varchar(128) |  |
| expected_result | text |  |
| status | varchar(16) | idx |

### 7.6 `uat_execution`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| execution_no | varchar(64) | unique per tenant |
| case_id | uuid | idx |
| executor_user_id | uuid | idx |
| status | varchar(16) | idx |
| block_reason_json | jsonb |  |
| evidence_json | jsonb |  |

## 8. AI 中台预留表

### 8.1 `ai_conversation`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| channel | varchar(16) | idx |
| user_id | uuid | idx |
| status | varchar(16) | idx |
| topic | varchar(128) |  |
| latest_intent | varchar(64) | idx |

### 8.2 `ai_message`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| conversation_id | uuid | idx |
| role_type | varchar(16) | idx |
| content_text | text |  |
| tool_calls_json | jsonb |  |
| risk_level | varchar(16) | idx |
| created_at | timestamp | idx |

### 8.3 `channel_binding`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| channel | varchar(16) | idx |
| external_user_id | varchar(128) | idx |
| platform_user_id | uuid | idx |
| binding_status | varchar(16) | idx |

索引建议：

- `uk_channel_binding (tenant_id, channel, external_user_id)`

### 8.4 `conversation_context_snapshot`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| conversation_id | uuid | idx |
| current_session_id | uuid | idx |
| last_order_id | uuid | idx |
| bound_device_id | uuid | idx |
| region_id | uuid | idx |
| snapshot_json | jsonb |  |

### 8.5 `ai_handoff`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| conversation_id | uuid | idx |
| handoff_type | varchar(32) | idx |
| status | varchar(16) | idx |
| target_work_order_id | uuid | idx |
| handoff_reason_json | jsonb |  |

## 9. 审计与日志表

### 9.1 `audit_log`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| actor_user_id | uuid | idx |
| module_code | varchar(64) | idx |
| resource_type | varchar(64) | idx |
| resource_id | uuid | idx |
| action_code | varchar(64) | idx |
| before_json | jsonb |  |
| after_json | jsonb |  |

### 9.2 `operation_log`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | pk |
| tenant_id | uuid | idx |
| trace_id | varchar(64) | idx |
| module_code | varchar(64) | idx |
| level | varchar(16) | idx |
| message | text |  |
| extra_json | jsonb |  |

## 10. 表间关键关系

| 上游表 | 下游表 | 关系 |
| --- | --- | --- |
| region | device | 1:N |
| device_type | device | 1:N |
| device | well / pump / valve | 1:1 |
| well | well_runtime_policy | 1:N |
| well / pump / valve | pump_valve_relation | 1:N |
| runtime_decision | runtime_session | 1:N |
| runtime_container | runtime_session | 1:N |
| runtime_session | command_dispatch | 1:N |
| runtime_session | irrigation_order | 1:1 or 1:N |
| alarm_event | work_order | 1:0..N |
| ai_conversation | ai_message | 1:N |
| ai_conversation | ai_handoff | 1:0..N |

## 11. 第一批迁移顺序建议

1. `tenant`, `sys_user`, `sys_role`, `sys_permission`, `sys_user_role`, `sys_role_permission`, `sys_data_scope`
2. `region`, `device_type`, `device`
3. `well`, `pump`, `valve`
4. `billing_package`, `well_runtime_policy`, `interaction_policy`, `scenario_template`, `topology_relation`, `pump_valve_relation`
5. `scan_ticket`, `runtime_decision`, `runtime_container`, `runtime_session`, `command_dispatch`, `session_status_log`
6. `irrigation_order`, `alarm_event`, `work_order`, `work_order_action_log`, `uat_case`, `uat_execution`
7. `ai_conversation`, `ai_message`, `channel_binding`, `conversation_context_snapshot`, `ai_handoff`
8. `audit_log`, `operation_log`
