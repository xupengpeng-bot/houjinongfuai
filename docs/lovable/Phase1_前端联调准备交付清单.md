# Phase 1 前端联调准备 — 交付清单

## 一、本轮变更文件清单

### 新增文件（API 基础层）
| 文件 | 说明 |
|------|------|
| `src/api/config.ts` | API 配置：mock/real 模式切换、API_BASE_URL |
| `src/api/client.ts` | 统一 fetch 客户端：headers / 错误封装 / 超时 / token |
| `src/api/types.ts` | 全量 DTO 类型，字段对齐 openapi.v1（snake_case） |
| `src/api/index.ts` | API 统一出口 |
| `src/api/mock/handlers.ts` | Mock 数据适配：将 mock-data 映射为 OpenAPI 结构 |
| `src/api/services/dashboard.ts` | 驾驶舱 |
| `src/api/services/auth.ts` | 认证 / IAM 占位 |
| `src/api/services/region.ts` | 区域管理 |
| `src/api/services/device-type.ts` | 设备类型 |
| `src/api/services/device-ledger.ts` | 设备台账 |
| `src/api/services/irrigation-assets.ts` | 机井 / 泵 / 阀 |
| `src/api/services/billing.ts` | 计费包 |
| `src/api/services/policy.ts` | 井级策略 |
| `src/api/services/topology.ts` | 泵阀关系 |
| `src/api/services/runtime.ts` | 运行会话 / 命令 / 容器 / 手动测试 |
| `src/api/services/order.ts` | 订单 |
| `src/api/services/alarm.ts` | 告警 |
| `src/api/services/work-order.ts` | 工单 |
| `src/api/services/uat.ts` | UAT 验收 |
| `src/api/services/ai-conversation.ts` | AI 白名单动作（5 个） |
| `src/api/services/mobile.ts` | 运维移动端 |
| `src/api/services/farmer.ts` | 农户端（含 RuntimeDecisionContract） |
| `src/api/services/iam.ts` | 用户权限 + 审计日志 |
| `src/hooks/use-api-queries.ts` | react-query hooks（全域覆盖） |
| `src/components/shared/StateComponents.tsx` | 通用状态组件：Loading/Error/Empty/Pagination/Skeleton |
| `.env.example` | 环境变量示例 |

### 修改文件（页面 API-ready 改造）
- `/ops`: Dashboard, AreaManagement, DeviceTypes, DeviceLedger, WellManagement, BillingPackages, WellStrategy, PumpValveRelation, RunSessions, CommandLog, ManualTest, RuntimeContainer, Orders, Alerts, WorkOrders, AuditLog, UAT, Users（共 18 页）
- `/m`: MyTodos, MyWorkOrders, Inspection, MyDevices, FieldProcess（共 5 页）
- `/u`: Session, History（共 2 页）

**总计：25 个新增文件，25 个修改文件**

---

## 二、页面树与路由清单（确认版）

### /ops — 管理后台（18 页）
| 路由 | 页面 | API Service | 状态 |
|------|------|-------------|------|
| `/ops` | 驾驶舱 | dashboardService | ✅ API-ready |
| `/ops/areas` | 区域管理 | regionService | ✅ API-ready |
| `/ops/device-types` | 设备类型 | deviceTypeService | ✅ API-ready |
| `/ops/devices` | 设备台账 | deviceLedgerService | ✅ API-ready |
| `/ops/wells` | 机井管理 | irrigationAssetsService | ✅ API-ready |
| `/ops/billing` | 计费包 | billingService | ✅ API-ready |
| `/ops/strategies` | 井级策略 | policyService | ✅ API-ready |
| `/ops/pump-valve` | 泵阀关系 | topologyService | ✅ API-ready |
| `/ops/sessions` | 运行会话 | runtimeService | ✅ API-ready |
| `/ops/commands` | 命令记录 | runtimeService | ✅ API-ready |
| `/ops/manual-test` | 手动测试 | runtimeService | ✅ API-ready |
| `/ops/runtime` | 运行容器 | runtimeService | ✅ API-ready |
| `/ops/orders` | 订单管理 | orderService | ✅ API-ready |
| `/ops/alerts` | 告警管理 | alarmService | ✅ API-ready |
| `/ops/work-orders` | 工单管理 | workOrderService | ✅ API-ready |
| `/ops/audit` | 日志/审计 | iamService | ✅ API-ready |
| `/ops/uat` | UAT 验收 | uatService | ✅ API-ready |
| `/ops/users` | 用户权限 | iamService | ✅ API-ready |
| `/ops/ai` | AI 配置 | — | 📌 Phase 2 预留，无 API 调用 |

### /m — 运维移动端（6 页）
| 路由 | 页面 | API Service | 状态 |
|------|------|-------------|------|
| `/m` | 工作台 | mobileService | ✅ API-ready |
| `/m/work-orders` | 工单 | mobileService | ✅ API-ready |
| `/m/inspection` | 巡检 | mobileService | ✅ API-ready |
| `/m/devices` | 设备 | mobileService | ✅ API-ready |
| `/m/field` | 现场处理 | mobileService | ✅ API-ready |
| `/m/profile` | 我的 | — | 📌 静态页 |

### /u — 农户端（6 页）
| 路由 | 页面 | API Service | 状态 |
|------|------|-------------|------|
| `/u` | 首页 | — | 📌 静态快捷入口 |
| `/u/scan` | 扫码 | farmerService.startCheck | ⚠️ 需接入 RuntimeDecisionContract |
| `/u/session` | 当前会话 | farmerService | ✅ API-ready |
| `/u/history` | 记录 | farmerService | ✅ API-ready |
| `/u/help` | 帮助/AI | aiConversationService | 📌 Phase 2 接入 |
| `/u/profile` | 我的 | — | 📌 静态页 |

---

## 三、API Service 文件结构清单

```
src/api/
├── config.ts               # 模式配置
├── client.ts               # fetch 封装
├── types.ts                # 全量 DTO
├── index.ts                # 出口
├── mock/
│   └── handlers.ts         # mock 数据映射
└── services/
    ├── dashboard.ts        # GET /dashboard/stats
    ├── auth.ts             # POST /auth/login, /logout, GET /auth/profile
    ├── region.ts           # CRUD /regions
    ├── device-type.ts      # CRUD /device-types
    ├── device-ledger.ts    # CRUD /devices
    ├── irrigation-assets.ts # CRUD /wells, GET /wells/:id/devices
    ├── billing.ts          # CRUD /billing-packages
    ├── policy.ts           # CRUD /well-strategies
    ├── topology.ts         # CRUD /pump-valve-relations
    ├── runtime.ts          # GET /run-sessions, /commands, /runtime/containers, POST /runtime/test-command
    ├── order.ts            # GET /orders
    ├── alarm.ts            # GET /alerts, PATCH /alerts/:id
    ├── work-order.ts       # CRUD /work-orders
    ├── uat.ts              # GET /uat-cases
    ├── ai-conversation.ts  # POST /ai/actions (5 白名单动作)
    ├── mobile.ts           # /mobile/* 运维端
    ├── farmer.ts           # /farmer/* 农户端 + RuntimeDecisionContract
    └── iam.ts              # GET /users, /audit-logs
```

---

## 四、Mock / Real 切换方案

### 切换方式

| 方式 | 操作 | 适用场景 |
|------|------|----------|
| 环境变量 | `.env` 中设置 `VITE_API_MODE=real` | 部署环境 |
| 运行时 JS | `import { setApiMode } from '@/api'; setApiMode('real');` | 测试代码 |
| 浏览器控制台 | `window.__setApiMode('real')` | 开发调试 |

### 原理
每个 service 方法内部判断 `isRealMode()`：
- `true` → 调用 `api.get/post(...)` 走真实后端
- `false` → 调用 `mock/handlers.ts` 中的 mock 函数

### Mock 数据约束
- Mock 返回结构严格对齐 OpenAPI DTO（snake_case）
- Mock 分页使用 `PaginatedResponse<T>` 信封
- Mock 延迟 300ms 模拟真实延迟

---

## 五、环境变量

```env
VITE_API_MODE=mock          # mock | real
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

---

## 六、仍未联调页面/接口清单

| 页面 | 缺失内容 | 优先级 |
|------|----------|--------|
| `/u/scan` | 未接入 startCheck → RuntimeDecisionContract 展示流 | 高 |
| `/u` 首页 | 未接入"最近用水"API | 中 |
| `/u/help` AI 入口 | Phase 2 接入，当前仅占位 | 低 |
| `/u/profile` | 未接入用户信息 + 余额 API | 中 |
| `/m/profile` | 未接入用户信息 API | 低 |
| `/ops/ai` | Phase 2 接入 | 低 |
| 全局 Auth | 登录/登出/token 管理未接入页面 | 高 |

---

## 七、下一轮建议任务（不自动执行）

1. **扫码 → 开泵全链路**：接入 `/u/scan` 的 `startCheck` → 展示 `RuntimeDecisionContract` → 创建会话 → 进入 `/u/session`
2. **全局 Auth 集成**：登录页 + token 管理 + 路由守卫
3. **农户首页动态化**：接入最近用水和账户余额 API
4. **表格筛选组件**：为 ops 列表页统一添加搜索/筛选栏
5. **Recharts 图表**：驾驶舱用水趋势 + 收入曲线
6. **详情抽屉/对话框**：设备详情、井详情、工单详情等侧边栏
