# 模块目录结构建议

## 1. 总体目标

目录结构要服务两件事：

- 让 Phase 1 能快速交付灌溉最小闭环。
- 让 Phase 2 的水肥和 AI 1.0 能在不推翻目录的情况下扩展。

不建议按“页面中心”分目录，建议按“治理、对象、规则、执行、事件、AI、基础设施”拆分。

## 2. 推荐工程结构

```text
backend/
  apps/
    api/
      src/
        main.*
        app.*
        modules/
          auth/
          iam/
          region/
          device-type/
          device-ledger/
          irrigation-assets/
          billing/
          policy/
          topology/
          runtime/
          order/
          alarm/
          work-order/
          uat/
          ai-conversation/
          dashboard/
          common/
        shared/
          dto/
          enums/
          errors/
          guards/
          interceptors/
          middleware/
          utils/
  packages/
    domain/
      src/
        iam/
        region/
        device/
        irrigation/
        billing/
        runtime/
        order/
        alarm/
        work-order/
        uat/
        ai/
        audit/
    application/
      src/
        commands/
        queries/
        services/
        policies/
        assemblers/
    infrastructure/
      src/
        persistence/
          migrations/
          repositories/
          entities/
        messaging/
        cache/
        id-generator/
        telemetry/
        device-gateway/
        ai-tools/
    contracts/
      src/
        openapi/
        events/
        schemas/
  scripts/
    seed/
    migration/
    uat/
  tests/
    integration/
    e2e/
    fixtures/
  docs/
    p1/
```

说明：

- `apps/api` 承担 HTTP 入口和模块装配。
- `packages/domain` 承担领域对象和领域规则。
- `packages/application` 承担用例编排和事务边界。
- `packages/infrastructure` 承担数据库、设备网关、日志、审计、AI 工具集成。
- `packages/contracts` 承担对外契约，方便和 Lovable 或其他前端统一接口。

## 3. 模块边界建议

### 3.1 `auth`

职责：

- 登录、登出、会话校验、当前用户解析。
- Token、刷新、终端登录态统一。

不负责：

- 角色授权配置。

### 3.2 `iam`

职责：

- 用户、角色、权限、数据范围。
- 菜单和按钮授权。

不负责：

- 业务对象查询和运行策略判定。

### 3.3 `region`

职责：

- 区域树、地块型区域、区域启停。
- 区域维度的数据范围校验。

不负责：

- 设备关系和运行关系。

### 3.4 `device-type`

职责：

- 设备类型管理。
- 能力定义、默认配置、动态表单 schema。

不负责：

- 某台具体设备的运行状态。

### 3.5 `device-ledger`

职责：

- 通用设备台账。
- 基础在线状态、心跳、安装信息、协议类型。

不负责：

- 专业井泵阀业务字段。

### 3.6 `irrigation-assets`

职责：

- 机井、泵、阀等 Phase 1 专业资产对象。
- 井泵阀业务属性、现场参数、专业约束。

不负责：

- 计费策略和运行编排。

### 3.7 `billing`

职责：

- 计费包管理。
- 价格预览、订单计价快照生成。

不负责：

- 是否允许启动。

### 3.8 `policy`

职责：

- 井级策略、交互策略、模板管理。
- 统一规则优先级合并。
- 输出 `effective_rule_snapshot`。

不负责：

- 命令投递和设备控制。

### 3.9 `topology`

职责：

- 通用关系边和 Phase 1 泵阀关系。
- 共享资源占用关系、互斥关系校验。

不负责：

- 订单和工单。

### 3.10 `runtime`

职责：

- 扫码解析、启动校验、运行决策、会话管理、运行容器、命令派发。
- 统一“允许 / 阻断 / 可执行动作”输出。
- 停机保护链。

不负责：

- 订单结算展示和财务复核。

这是 Phase 1 最核心的后端模块，建议内部再拆成：

```text
runtime/
  decision/
  session/
  container/
  command/
  protection/
  telemetry/
```

### 3.11 `order`

职责：

- 会话到订单的映射。
- 金额冻结、订单查询、异常复核。

不负责：

- 启停决策。

### 3.12 `alarm`

职责：

- 告警规则落地、告警聚合、确认和关闭。
- 告警到工单的联动。

不负责：

- 现场工单执行。

### 3.13 `work-order`

职责：

- 工单生命周期、派单、接单、处理、复核。
- /m 运维端工作台的待办聚合。

不负责：

- 设备直接控制。

### 3.14 `uat`

职责：

- 验收项模板、角色验收执行、阻塞项留痕。

不负责：

- 生产运行主链裁决。

### 3.15 `ai-conversation`

职责：

- AI 会话、消息、渠道绑定、上下文快照、转人工。
- AI 工具调用白名单。

不负责：

- 直接控制泵、阀、计费规则。

建议内部再拆成：

```text
ai-conversation/
  conversation/
  message/
  binding/
  context/
  handoff/
  tools/
```

### 3.16 `dashboard`

职责：

- 驾驶舱汇总查询。
- 今日任务、风险待办、订单统计等只读聚合。

不负责：

- 原子业务写操作。

### 3.17 `common`

职责：

- 枚举、错误码、分页、审计装饰器、统一响应对象、基础校验器。

## 4. 推荐的模块依赖方向

```text
iam, region, device-type, device-ledger, irrigation-assets
  -> policy, topology
  -> runtime
  -> order, alarm
  -> work-order, uat
  -> ai-conversation
```

依赖规则：

- `runtime` 可以依赖 `policy`、`topology`、`device-ledger`、`irrigation-assets`。
- `order` 依赖 `runtime` 和 `billing`，不反向被 `runtime` 依赖业务实现。
- `work-order` 可依赖 `alarm` 的事件，不应反向控制 `alarm` 规则引擎。
- `ai-conversation` 只能通过工具接口调用 `runtime`、`order`、`work-order` 的只读或受控动作。

## 5. 目录与三端协同建议

### 5.1 `/ops` 后台主要对应模块

| 菜单 | 后端模块 |
| --- | --- |
| 驾驶舱 | dashboard |
| 对象中心 | region、device-type、device-ledger、irrigation-assets |
| 规则与编排中心 | billing、policy、topology |
| 任务与运行中心 | runtime |
| 事件中心 | order、alarm |
| 工单中心 | work-order |
| 系统中心 | iam、uat、ai-conversation |

### 5.2 `/m` 运维移动端主要对应模块

| 页面 | 后端模块 |
| --- | --- |
| 我的待办 | work-order、alarm、dashboard |
| 我的工单 | work-order |
| 我的设备 | device-ledger、irrigation-assets |
| 现场处理 | runtime、work-order |

### 5.3 `/u` 农户端主要对应模块

| 页面 | 后端模块 |
| --- | --- |
| 扫码 | runtime |
| 当前会话 | runtime |
| 历史 / 订单 | runtime、order |
| 帮助 / AI | ai-conversation、order、work-order |

## 6. 第一阶段代码组织建议

如果要尽快进入开发，建议第一批实现按下面顺序开模块：

1. `common`, `auth`, `iam`
2. `region`, `device-type`, `device-ledger`, `irrigation-assets`
3. `billing`, `policy`, `topology`
4. `runtime`
5. `order`, `alarm`
6. `work-order`, `uat`
7. `ai-conversation`

这样可以确保先把“对象 -> 规则 -> 执行 -> 事件 -> 验收”主链打穿，再补 AI 预留。

## 7. 工程化补充建议

- `runtime`、`order`、`work-order`、`ai-conversation` 必须统一接入审计日志。
- 所有状态流转通过领域服务完成，不允许控制器直接改表。
- 规则优先级合并建议封装在单独服务，例如 `EffectivePolicyResolver`。
- 运行校验建议封装在单独服务，例如 `RuntimeDecisionService`。
- AI 工具调用建议通过白名单注册，例如 `AiToolRegistry`，避免后续越权。
