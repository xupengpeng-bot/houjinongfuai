# Phase 1 页面-API-DTO-状态机映射表

> 联调冻结版 v1.0 | 2026-03-21

## 对象承载边界决策

| 对象 | 承载方式 | 说明 |
|------|----------|------|
| 泵(Pump) | 设备台账子类型 + 机井详情页子页签 | 泵是 `device` 表中 `type=pump_controller` 的记录，在机井详情页以"关联设备"页签展示 |
| 阀(Valve) | 设备台账子类型 + 机井详情页子页签 | 阀是 `device` 表中 `type=valve` 的记录，同上 |
| 泵阀关系 | 独立页面 `/ops/pump-valve` | 配置泵阀联动顺序与延时，属规则层 |

**资源模型**: 泵/阀不设独立表，复用 `devices` 表通过 `device_type_id` 区分。机井详情通过 `well_id` 外键关联查询。

---

## /ops 管理后台

### 驾驶舱 `/ops`
| 层级 | 对象层(汇总) |
|------|-------------|
| API | `GET /api/v1/dashboard/stats` |
| DTO | `DashboardStatsDTO { totalWells, runningWells, totalDevices, onlineDevices, todayOrders, todayUsage, todayRevenue, pendingAlerts, openWorkOrders, monthlyUsage, monthlyRevenue, deviceOnlineRate }` |
| 状态机 | 无 |

### 区域管理 `/ops/areas`
| 层级 | 对象层 |
|------|--------|
| API | `GET /api/v1/areas` · `POST /api/v1/areas` · `PUT /api/v1/areas/:id` · `DELETE /api/v1/areas/:id` |
| DTO | `AreaDTO { id, name, province, city, district, wells, devices, status }` |
| 状态机 | `active ↔ disabled` |

### 设备类型 `/ops/device-types`
| 层级 | 对象层 |
|------|--------|
| API | `GET /api/v1/device-types` · `POST /api/v1/device-types` · `PUT /api/v1/device-types/:id` |
| DTO | `DeviceTypeDTO { id, name, category, protocol, params[], count }` |
| 状态机 | 无(配置型) |

### 设备台账 `/ops/devices`
| 层级 | 对象层 |
|------|--------|
| API | `GET /api/v1/devices` · `POST /api/v1/devices` · `PUT /api/v1/devices/:id` · `GET /api/v1/devices/:id` |
| DTO | `DeviceDTO { id, name, type, typeId, areaId, wellId, sn, status, lastReport, battery? }` |
| 状态机 | `offline → online → alarm → offline` (由设备上报驱动，后端判定) |
| 说明 | 泵控制器(typeId=DT02)和电磁阀(typeId=DT03)均为本表记录 |

### 机井管理 `/ops/wells`
| 层级 | 对象层 |
|------|--------|
| API | `GET /api/v1/wells` · `POST /api/v1/wells` · `PUT /api/v1/wells/:id` · `GET /api/v1/wells/:id` |
| DTO | `WellDTO { id, name, areaId, depth, pumpModel, flowRate, status, dailyUsage, monthlyUsage }` |
| DTO(详情) | 含 `relatedDevices: DeviceDTO[]` (泵/阀/水表作为子页签展示) |
| 状态机 | `idle → running → maintenance → idle` (后端决策) |

### 计费包 `/ops/billing`
| 层级 | 规则层 |
|------|--------|
| API | `GET /api/v1/billing-packages` · `POST /api/v1/billing-packages` · `PUT /api/v1/billing-packages/:id` |
| DTO | `BillingPackageDTO { id, name, type(volume/duration/free), unit, price, minCharge, status, wells }` |
| 状态机 | `active ↔ disabled ↔ trial` |

### 井级策略 `/ops/strategies`
| 层级 | 规则层 |
|------|--------|
| API | `GET /api/v1/well-strategies` · `POST /api/v1/well-strategies` · `PUT /api/v1/well-strategies/:id` |
| DTO | `WellStrategyDTO { id, wellId, billingPackageId, maxDaily, maxSession, idleTimeout, priority }` |
| 状态机 | 无(配置型，优先级最高) |
| 规则 | 井级策略 > 关系配置 > 交互策略 > 模板 > 设备类型默认值 |

### 泵阀关系 `/ops/pump-valve`
| 层级 | 规则层 |
|------|--------|
| API | `GET /api/v1/pump-valve-relations` · `POST /api/v1/pump-valve-relations` · `PUT /api/v1/pump-valve-relations/:id` |
| DTO | `PumpValveRelationDTO { id, wellId, pumpDeviceId, valveDeviceId, sequence(valve_first/pump_first/simultaneous), valveDelay, pumpDelay, status }` |
| 状态机 | `active ↔ disabled` |

### 运行会话 `/ops/sessions`
| 层级 | 执行层 |
|------|--------|
| API | `GET /api/v1/run-sessions` · `GET /api/v1/run-sessions/:id` |
| DTO | `RunSessionDTO { id, wellId, userId, startTime, endTime?, flow, duration, status }` |
| 状态机 | `created → running → ending → ended → settled` (后端引擎驱动) |
| 说明 | 前端只读，不创建/修改会话 |

### 命令记录 `/ops/commands`
| 层级 | 执行层 |
|------|--------|
| API | `GET /api/v1/commands` |
| DTO | `CommandDTO { id, time, sessionId?, targetDeviceId, action, source(session_engine/manual/alert_handler), result }` |
| 状态机 | `pending → sent → ack → success/timeout/failed` |

### 手动测试 `/ops/manual-test`
| 层级 | 执行层 |
|------|--------|
| API | `POST /api/v1/commands/test` (需管理员权限) |
| DTO | `TestCommandRequest { deviceId, action }` → `CommandDTO` |
| 状态机 | 复用命令状态机 |

### 运行容器 `/ops/runtime`
| 层级 | 执行层(监控) |
|------|-------------|
| API | `GET /api/v1/runtime/services` |
| DTO | `ServiceStatusDTO { id, name, status, cpu, memory, uptime }` |
| 状态机 | `running ↔ stopped ↔ error` |

### 订单管理 `/ops/orders`
| 层级 | 事件层 |
|------|--------|
| API | `GET /api/v1/orders` · `GET /api/v1/orders/:id` |
| DTO | `OrderDTO { id, userId, userName, phone, wellId, billingPackageId, startTime, endTime?, usage, unit, amount, status }` |
| 状态机 | `active → completed → refunded` (后端结算) |
| 说明 | 前端只读，订单由会话引擎自动生成 |

### 告警管理 `/ops/alerts`
| 层级 | 事件层 |
|------|--------|
| API | `GET /api/v1/alerts` · `PUT /api/v1/alerts/:id/acknowledge` · `PUT /api/v1/alerts/:id/resolve` |
| DTO | `AlertDTO { id, deviceId, deviceName, type, level(info/warning/error), time, areaId, status, desc }` |
| 状态机 | `pending → processing → resolved / dismissed` |

### 日志/审计 `/ops/audit`
| 层级 | 事件层 |
|------|--------|
| API | `GET /api/v1/audit-logs` |
| DTO | `AuditLogDTO { id, time, actor, action(CREATE/UPDATE/DELETE), resource, detail, ip }` |
| 状态机 | 无(追加写入) |

### 工单管理 `/ops/work-orders`
| 层级 | 执行层 |
|------|--------|
| API | `GET /api/v1/work-orders` · `POST /api/v1/work-orders` · `PUT /api/v1/work-orders/:id` · `GET /api/v1/work-orders/:id` |
| DTO | `WorkOrderDTO { id, title, type, alertId?, areaId, wellId?, assigneeId, priority, status, created, deadline }` |
| 状态机 | `created → assigned → in_progress → completed → closed` |

### UAT 验收 `/ops/uat`
| 层级 | 验收层 |
|------|--------|
| API | `GET /api/v1/uat-cases` · `PUT /api/v1/uat-cases/:id` |
| DTO | `UATCaseDTO { id, module, scenario, steps, passed, status(pass/fail/pending), tester, date }` |
| 状态机 | `pending → pass / fail` |

### 用户权限 `/ops/users`
| 层级 | 系统层 |
|------|--------|
| API | `GET /api/v1/users` · `POST /api/v1/users` · `PUT /api/v1/users/:id` · `PUT /api/v1/users/:id/role` |
| DTO | `UserDTO { id, name, username, role(admin/operator/farmer), areaId, phone, status }` |
| 状态机 | `active ↔ disabled` |

### AI 配置/预留 `/ops/ai`
| 层级 | 系统层 |
|------|--------|
| API | Phase 1 预留，不实现 |
| 说明 | 仅展示 AI 入口壳子与受控动作列表 |

---

## /m 运维移动端

### 工作台 `/m`
| 层级 | 执行层(汇总) |
|------|-------------|
| API | `GET /api/v1/mobile/dashboard` (按当前用户过滤) |
| DTO | `MobileDashboardDTO { pendingTodos, assignedWorkOrders, myDevices, urgentAlerts }` |

### 工单 `/m/work-orders`
| API | `GET /api/v1/work-orders?assignee=me` · `PUT /api/v1/work-orders/:id` |
| 状态机 | 同工单管理 |

### 巡检 `/m/inspection`
| 层级 | 执行层 |
| API | `GET /api/v1/inspections?assignee=me` · `POST /api/v1/inspections/:id/check` |
| DTO | `InspectionDTO { id, wellId, items[], assignee, scheduledDate, status }` |
| 状态机 | `scheduled → in_progress → completed` |

### 设备 `/m/devices`
| API | `GET /api/v1/devices?assignee=me` |

### 现场处理 `/m/field`
| 层级 | 执行层 |
| API | `POST /api/v1/field-actions` (签到/拍照/完工) |
| DTO | `FieldActionDTO { type(checkin/photo/complete), workOrderId, location?, photoUrl?, note? }` |

### 个人中心 `/m/profile`
| API | `GET /api/v1/users/me` · `PUT /api/v1/users/me` |

---

## /u 农户端

### 首页 `/u`
| 层级 | 执行层(用户视图) |
| API | `GET /api/v1/farmer/home` |
| DTO | `FarmerHomeDTO { activeSession?, recentOrders[], bindWells[], balance }` |

### 扫码 `/u/scan`
| API | `POST /api/v1/farmer/scan` → 返回会话创建结果(后端决策) |
| DTO | `ScanRequest { qrCode }` → `ScanResultDTO { sessionId?, wellName, status, message }` |

### 当前会话 `/u/session`
| API | `GET /api/v1/farmer/session/active` · `POST /api/v1/farmer/session/stop` |
| DTO | `FarmerSessionDTO { id, wellName, startTime, flow, duration, estimatedCost, status }` |
| 状态机 | `running → stopping → ended` (前端只能请求停止，后端执行) |

### 历史/订单 `/u/history`
| API | `GET /api/v1/farmer/orders` |
| DTO | 复用 `OrderDTO` (按当前用户过滤) |

### 帮助/AI `/u/help`
| 层级 | 系统层 |
| API | Phase 1 仅展示入口，Phase 2 对接 AI 网关 |
| 受控动作 | FAQ查询、查会话、查订单、转人工、故障上报 |

### 我的 `/u/profile`
| API | `GET /api/v1/users/me` · `PUT /api/v1/users/me` |
