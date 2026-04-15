# Embedded Controller Storage And Cache Spec v1

## 1. 文档目的

这份文档专门回答 3 个问题：

- 控制器接入后，数据应该落到哪些表
- 哪些数据应该只放缓存，哪些必须落库
- 现有平台在这块已经做到哪一步，下一步该怎么补齐

本文档基于当前仓库里的后端实现，不是脱离代码的空设计。

主要参考：

- [device-ledger.repository.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-ledger/device-ledger.repository.ts)
- [device-type.module.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-type/device-type.module.ts)
- [device-gateway.service.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-gateway/device-gateway.service.ts)
- [tcp-json-v1.server.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/device-gateway/tcp-json-v1.server.ts)
- [006_device_runtime_foundation.sql](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/sql/migrations/006_device_runtime_foundation.sql)

## 2. 总体原则

核心原则只有一句话：

- **数据库是真相源**
- **缓存只做加速和在线连接辅助**

不要把下面这些关键状态只放缓存：

- 命令是否已发送
- 设备是否已 ACK
- 当前业务会话是否还有效
- 停机/结算是否完成
- 升级任务是否成功

这些都必须可追溯、可恢复、可审计，所以必须落库。

## 3. 当前后端已存在的基础

## 3.1 静态对象层

### `device_type`

当前已经支持：

- `capability_json`
- `default_config_json`
- `form_schema_json`

职责：

- 描述控制器类型模板
- 描述默认模块能力
- 描述默认配置模板
- 描述前端表单模板

这张表回答：

- 这类设备通常支持什么
- 默认如何配置

### `device`

当前仍然是控制器实例主表。  
通过扩展字段已经承载了大量控制器配置：

- `imei`
- `protocol_version`
- `connection_state`
- `last_device_ts`
- `protocol_config_json`
- `ext_json`

其中 `ext_json` 当前已经被用于承载：

- `project_id`
- `block_id`
- `source_module`
- `source_node_code`
- `source_unit_code`
- `iccid`
- `module_model`
- `firmware_version`
- `hardware_sku`
- `hardware_rev`
- `firmware_family`
- `controller_role`
- `deployment_mode`
- `config_version`
- `feature_modules`
- `resource_inventory`
- `channel_bindings`
- `runtime_rules`
- `last_register_payload`
- `auto_identified`

这张表回答：

- 哪台控制器安装在什么点位
- 当前配置版本是什么
- 控制器的静态身份是什么

## 3.2 连接与命令层

### `device_connection_session`

已存在，见 [006_device_runtime_foundation.sql](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/sql/migrations/006_device_runtime_foundation.sql)。

职责：

- 记录每次连接会话
- 记录 `imei -> 当前活动 connection_id`
- 记录谁覆盖了旧连接

这张表回答：

- 当前哪条连接是活动连接
- 某次断线和重连什么时候发生

### `device_command`

已存在。

职责：

- 记录平台下发的控制命令
- 记录命令状态流转
- 记录请求体和响应体

当前适合承载：

- `QUERY`
- `EXECUTE_ACTION`
- `ota_*`
- `SYNC_CONFIG`

这张表回答：

- 平台到底发过什么
- 设备到底有没有 ACK/NACK
- 这条命令后面是否超时/重试/死信

### `device_message_log`

已存在。

职责：

- 原始消息流水
- 幂等
- 排序
- 审计

这张表回答：

- 设备到底发过哪条报文
- 平台到底收到了什么
- 某次 ACK 是不是重复包

## 3.3 业务运行层

### `runtime_session`

现有灌溉业务会话主表，已经补了：

- `session_ref`
- `device_key`
- `start_command_id`
- `stop_command_id`
- `command_sent_at`
- `device_acked_at`
- `last_event_at`
- `last_event_seq_no`
- `state_version`

职责：

- 记录一轮业务运行会话
- 把设备动作和业务订单绑定起来

### `session_status_log`

已存在，见 [session-status-log.repository.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/modules/runtime/session-status-log.repository.ts)。

职责：

- 记录业务会话状态迁移
- 记录迁移动作和原因

### `irrigation_order`

当前仍是业务订单主表，和 `runtime_session` 紧密关联。

## 3.4 网关现状

当前并没有单独 Redis 作为核心依赖。  
从 [app.module.ts](D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/backend/src/app.module.ts) 和 `device-gateway` 模块实现看：

- TCP 长连接由进程内 `net.Server` 持有
- `imei -> connection` 的即时关系主要由进程内 socket + `device_connection_session` 配合维护
- 重试和断连修复靠后台定时器

也就是说，当前是：

- **DB 真相源**
- **进程内连接态**
- **没有专门 Redis 真相层**

这个方向是对的。

## 4. 我建议的存储分层

建议固定成 5 层：

## 4.1 配置真相层

表：

- `device_type`
- `device`

职责：

- 设备类型模板
- 控制器实例
- 静态身份
- 当前配置
- 点位来源归属

## 4.2 连接真相层

表：

- `device_connection_session`

职责：

- 连接建立
- 覆盖旧连接
- 断开
- 恢复

## 4.3 消息真相层

表：

- `device_message_log`

职责：

- 原始报文归档
- 幂等检查
- 排序恢复
- 审计

## 4.4 命令真相层

表：

- `device_command`

职责：

- 平台发命令
- 设备回 ACK/NACK
- 重试/超时/死信

## 4.5 业务真相层

表：

- `runtime_session`
- `session_status_log`
- `irrigation_order`

职责：

- 业务会话
- 状态流转
- 资金/结算

## 5. 当前最缺的两张表

现在最缺的不是更多日志表，而是两张“最新状态快照表”。

## 5.1 `device_runtime_shadow`

建议新增。

用途：

- 每台控制器只保留一行最新运行快照
- 列表页、监控页、工作台直接读这张表
- 不再频繁扫 `device_message_log`

建议字段：

- `id`
- `tenant_id`
- `device_id`
- `imei`
- `last_msg_id`
- `last_seq_no`
- `last_msg_type`
- `last_heartbeat_at`
- `last_snapshot_at`
- `last_event_at`
- `connection_state`
- `online_state`
- `workflow_state`
- `power_state`
- `ready`
- `signal_csq`
- `battery_soc`
- `battery_voltage`
- `solar_voltage`
- `firmware_version`
- `config_version`
- `alarm_codes_json`
- `common_status_json`
- `module_states_json`
- `updated_at`

主用途：

- 首页运行总览
- 点位控制器状态卡片
- 运行监控列表

## 5.2 `device_channel_latest`

建议新增。

用途：

- 按通道保存最新一个测点值
- 压力、流量、电表、土壤墒情、液位等都走这里

建议字段：

- `id`
- `tenant_id`
- `device_id`
- `imei`
- `channel_code`
- `metric_code`
- `module_code`
- `value_num`
- `value_text`
- `unit`
- `quality`
- `collected_at`
- `server_rx_ts`
- `updated_at`

唯一键建议：

- `(tenant_id, imei, channel_code, metric_code)`

主用途：

- 最新压力
- 最新流量
- 最新电表读数
- 最新土壤墒情

## 6. 为什么不能只靠日志表

只靠 `device_message_log` 有 4 个问题：

- 列表查询太重
- 取最新值要排序和聚合
- 前端高频刷新成本高
- 快照语义和审计语义混在一起

所以：

- `device_message_log` 继续保留做审计
- `device_runtime_shadow` 做控制器最新态
- `device_channel_latest` 做测点最新态

## 7. 缓存策略建议

## 7.1 L1：进程内缓存

只放短命、高频、允许丢的数据：

- `imei -> active socket`
- `connection_id -> socket`
- 短期未发送命令对象
- 最近一次心跳时间镜像
- 最近一次 `common_status` 临时镜像

特点：

- 生命周期跟网关进程一致
- 不要求进程重启后保留

## 7.2 L2：共享缓存，可选 Redis

只有当后面要多实例网关时再建议上。

适合放：

- `imei -> active gateway instance`
- `imei -> active connection_id`
- 短 TTL 在线态镜像
- 待派发命令提醒
- 极短期幂等键

不适合放：

- 最终命令状态
- 最终业务会话状态
- 停机/结算结果

## 7.3 现阶段是否必须上 Redis

我的判断：**现在不是必须。**

原因：

- 你们当前是单进程/少实例阶段
- `device_connection_session` 已经能做连接真相源
- `device_command` 已经能做命令真相源
- 先把快照表补齐，收益会比先上 Redis 大得多

## 8. 典型读写路径

## 8.1 设备注册

写路径：

1. 网关收 `REGISTER`
2. 写 `device_message_log`
3. 更新 `device`
   - `imei`
   - `protocol_version`
   - `last_device_ts`
   - `connection_state`
   - `ext_json.last_register_payload`
4. 更新或创建 `device_connection_session`
5. 更新 `device_runtime_shadow`

## 8.2 心跳

写路径：

1. 网关收 `HEARTBEAT`
2. 写 `device_message_log`
3. 更新 `device.last_device_ts`
4. 更新 `device.connection_state`
5. 更新 `device_runtime_shadow.last_heartbeat_at`

不需要：

- 每次心跳都创建业务会话

## 8.3 查询压力/流量/电表

设备上报后：

1. 写 `device_message_log`
2. 更新 `device_channel_latest`
3. 若影响控制器摘要，也更新 `device_runtime_shadow`

前端查最新值时：

- 直接读 `device_channel_latest`

## 8.4 平台下发开阀/启泵

写路径：

1. 创建 `device_command`
2. 若涉及业务会话，更新 `runtime_session`
3. 网关尝试投递
4. 设备回 `ACK/NACK`
5. 更新 `device_command`
6. 后续再由 `STATE_SNAPSHOT / EVENT_REPORT` 更新：
   - `device_runtime_shadow`
   - `runtime_session`
   - `session_status_log`

## 8.5 OTA 升级

写路径建议：

1. 创建 `device_command`，`command_code=ota_prepare`
2. 设备回 ACK/NACK
3. 设备上报升级进度到 `device_message_log`
4. `device_runtime_shadow` 更新：
   - `firmware_version`
   - `common_status_json.ota_state`
5. 如果需要更细升级记录，后续可再补 `device_upgrade_job`

## 9. 索引建议

当前已有：

- `device(tenant_id, imei)` 唯一索引
- `device_connection_session(tenant_id, imei)` 活动连接唯一索引
- `device_message_log` 幂等和排序索引
- `device_command(tenant_id, command_id)` 唯一索引
- `device_command(tenant_id, imei, command_status)` 查询索引

建议新增：

### `device_runtime_shadow`

- 唯一：`(tenant_id, imei)`
- 查询：`(tenant_id, connection_state, workflow_state)`
- 查询：`(tenant_id, updated_at desc)`

### `device_channel_latest`

- 唯一：`(tenant_id, imei, channel_code, metric_code)`
- 查询：`(tenant_id, device_id, updated_at desc)`
- 查询：`(tenant_id, metric_code, updated_at desc)`

## 10. 数据保留策略

## 10.1 长留

长期保留：

- `device`
- `device_type`
- `runtime_session`
- `session_status_log`
- `device_command`

## 10.2 可归档

建议按时间归档：

- `device_message_log`

因为它增长最快。

## 10.3 只保留最新

只保留当前值：

- `device_runtime_shadow`
- `device_channel_latest`

## 11. 当前现状判断

这套后端当前已经做对了 3 件事：

- 把运行真相源从业务对象里拆出来了
- 把 `device_command` 和 `device_message_log` 建起来了
- 把连接会话单独建表了

但还差 2 件最关键的补强：

- `runtime-ingest` 现在还是骨架，没有真正把消息稳定落成快照层
- 缺少“最新状态快照表”和“最新通道值表”

## 12. 我的建议排序

如果你们现在就要往前推进，我建议顺序是：

1. 补 `device_runtime_shadow`
2. 补 `device_channel_latest`
3. 把 `runtime-ingest` 从 skeleton 变成真实入库链
4. 再考虑 Redis 这类共享缓存

也就是说：

- 先补“查得快”
- 再补“多实例网关”

## 13. 最终结论

你们这套控制器接入最顺的存储方案是：

- `device_type + device` 负责静态配置
- `device_connection_session` 负责连接真相
- `device_message_log` 负责原始消息审计
- `device_command` 负责命令真相
- `runtime_session + session_status_log + irrigation_order` 负责业务真相
- 再补：
  - `device_runtime_shadow`
  - `device_channel_latest`

缓存层只做：

- 在线 socket
- 短期在线态
- 短期投递辅助

不要让缓存承担最终状态真相源。
