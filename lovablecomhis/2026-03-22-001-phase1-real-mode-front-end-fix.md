# Lovable 指令

## 元信息

- 编号：`2026-03-22-001`
- 日期：`2026-03-22`
- 主题：`Phase 1 真实联调前端收口修复`
- 前端仓库：`D:\20251211\zhinengti\lovable`
- 来源仓库：`D:\20251211\zhinengti\houjinongfuai`
- 状态：`待 Lovable 执行`

## 目标

在不新增页面、不改路由、不扩业务边界的前提下，修复 `real` 模式下页面因接口响应壳、空值、错误路径导致的白屏或崩溃问题。本轮只改前端仓库，不改后端仓库。

## 约束

1. 不新增页面
2. 不改整体信息架构
3. 不改路由结构
4. 不自行推导价格、安全、运行规则
5. 所有价格、会话状态、阻断原因、可执行动作都只展示后端返回
6. 不把 mock 逻辑混进 real 模式页面展示
7. 必须保证 `npm run build` 通过

## 必做项

### 1. 统一真实模式列表响应壳

请修改这些文件：

- `src/hooks/use-api-queries.ts`
- `src/api/services/alarm.ts`
- `src/api/services/billing.ts`
- `src/api/services/device-ledger.ts`
- `src/api/services/device-type.ts`
- `src/api/services/irrigation-assets.ts`
- `src/api/services/order.ts`
- `src/api/services/runtime.ts`
- `src/api/services/topology.ts`
- `src/api/services/work-order.ts`

要求：

1. `real` 模式下，后端常见返回形状是：

```ts
{ requestId, code, message, data: { items: [...] } }
```

2. 所有列表接口最终都要给页面返回统一结构：

```ts
{ items: [], total: number, page: number, page_size: number }
```

3. 若后端未返回 `total/page/page_size`，前端兜底：

```ts
total = items.length
page = request.page ?? 1
page_size = request.page_size ?? 20
```

4. 页面不能再直接吃响应壳，必须由 service 或 hook 统一拆壳。

建议在 `src/hooks/use-api-queries.ts` 新增这个工具函数并统一复用：

```ts
function normalizePaginated<T>(raw: unknown, page = 1, page_size = 20) {
  const payload = raw as {
    data?: { items?: T[]; total?: number; page?: number; page_size?: number };
    items?: T[];
    total?: number;
    page?: number;
    page_size?: number;
  } | null;

  const source = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const items = Array.isArray(source?.items) ? source.items : [];

  return {
    items,
    total: Number(source?.total ?? items.length),
    page: Number(source?.page ?? page),
    page_size: Number(source?.page_size ?? page_size),
  };
}
```

并把 `useListQuery` 改成统一通过 `normalizePaginated(...)` 返回数据。

### 2. 修正已知路径错位

请核对并修正这些路径：

- `policy` 改为 `/well-runtime-policies`
- `iam` 用户列表改为 `/system/users`
- `uat` 列表改为 `/uat/cases`
- 当前会话改为 `/farmer/session/active`
- 运行会话列表改为 `/run-sessions`

如果某些 create/update/getById 页面当前没被实际使用，不要主动调用后端不存在的详情接口；保持不触发或空态即可。

### 3. 页面层防崩

请重点修这些页面：

- `src/pages/ops/Alerts.tsx`
- `src/pages/ops/BillingPackages.tsx`
- `src/pages/ops/CommandLog.tsx`
- `src/pages/ops/DeviceLedger.tsx`
- `src/pages/ops/DeviceTypes.tsx`
- `src/pages/ops/Orders.tsx`
- `src/pages/ops/PumpValveRelation.tsx`
- `src/pages/ops/RunSessions.tsx`
- `src/pages/ops/UAT.tsx`
- `src/pages/ops/Users.tsx`
- `src/pages/ops/WellManagement.tsx`
- `src/pages/ops/WellStrategy.tsx`
- `src/pages/ops/WorkOrders.tsx`
- `src/pages/m/MyTodos.tsx`
- `src/pages/u/History.tsx`
- `src/pages/u/Scan.tsx`
- `src/pages/u/Session.tsx`

统一改法：

```ts
const items = data?.items ?? [];
const total = data?.total ?? items.length;
```

把以下模式全部替换掉：

- `!data?.items.length` 改为 `!items.length`
- `data.items.map(...)` 改为 `items.map(...)`
- `data.total` 改为 `total`

所有危险读取都先做兜底：

```ts
Number(x ?? 0).toFixed(2)
Number(x ?? 0).toLocaleString()
Array.isArray(x) ? x.join("、") : "--"
```

不允许再出现这些错误：

- `Cannot read properties of undefined (reading 'length')`
- `Cannot read properties of undefined (reading 'toLocaleString')`
- `Cannot read properties of undefined (reading 'filter')`
- `Cannot read properties of undefined (reading 'join')`

### 4. 高风险文件精确修改要求

#### `src/api/services/policy.ts`

请改成：

```ts
listWellStrategies -> GET /well-runtime-policies
createWellStrategy -> POST /well-runtime-policies
updateWellStrategy -> PATCH /well-runtime-policies/:id
```

#### `src/api/services/iam.ts`

请改成：

```ts
listUsers -> GET /system/users
listAuditLogs -> real 模式返回空分页，不要调用不存在接口
```

#### `src/api/services/uat.ts`

请改成：

```ts
list -> GET /uat/cases
```

#### `src/api/services/mobile.ts`

请改成：

```ts
getMyWorkOrders -> GET /m/my/work-orders
getMyAlerts -> real 模式返回空分页
getMyDevices -> real 模式返回空分页
getInspections -> real 模式返回空分页
```

#### `src/pages/u/Scan.tsx`

请确保：

1. `decision` 保存完整接口响应
2. 页面读取使用：

```ts
const result = decision?.data?.result ?? "deny";
const blockingReasons = decision?.data?.blockingReasons ?? [];
const availableActions = decision?.data?.availableActions ?? [];
const pricePreview = decision?.data?.pricePreview ?? null;
```

3. `createSession` 成功后只按后端返回跳转，不本地推导

#### `src/pages/m/MyTodos.tsx`

请确保：

```ts
const alertItems = alertsQuery.data?.items ?? [];
const workOrderItems = workOrdersQuery.data?.items ?? [];
```

之后再做 `filter(...)`。

#### `src/pages/ops/DeviceTypes.tsx`

请确保：

```ts
const items = data?.items ?? [];
const total = data?.total ?? items.length;
const paramsText = Array.isArray(deviceType.params) ? deviceType.params.join("、") : "--";
const count = Number(deviceType.count ?? 0);
```

#### `src/pages/ops/WellManagement.tsx`

请确保：

```ts
const items = data?.items ?? [];
const total = data?.total ?? items.length;
const monthlyUsage = Number(well.monthly_usage ?? 0).toLocaleString();
```

#### `src/pages/ops/UAT.tsx`

请确保：

```ts
const items = data?.items ?? [];
const total = data?.total ?? items.length;
const passed = items.filter((item) => item.status === "pass").length;
```

## 交付要求

完成后请输出：

1. 修改文件清单
2. 已修复页面清单
3. 仍依赖后端补实现的页面清单
4. `npm run build` 结果
5. 一句提示：请告诉 Codex“Lovable 已完成”，以便继续做后端核查

## 验收标准

1. `npm run build` 通过
2. `real` 模式下常见页面不再出现上述 undefined 崩溃
3. 不新增页面
4. 不修改 UI 信息架构
5. 不引入前端规则引擎
