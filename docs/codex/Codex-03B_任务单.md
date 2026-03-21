# Codex-03B 任务单

项目：后稷农事服务 AI 综合平台（Phase 1）  
任务名：Codex-03B：在不改 OpenAPI v1 的前提下，补齐 runtime 边界规则与仓储一致性

## 0. 任务前提
- 延续 Codex-03A 已有实现，不回退、不改路由、不改 DTO 契约。
- `openapi.v1.yaml` 保持冻结。
- 不进入 JWT / RBAC / AI / 告警复杂流转 / 工单复杂流转。
- 前端继续只读后端返回，不新增前端推导逻辑。

## 1. 本轮目标
在已打通 `policy + topology + runtime + order` 主链的基础上，补齐“边界规则正确性 + 事务一致性 + 幂等性 + fallback 策略参与合并”。

## 2. 本轮范围
仅允许修改以下域：
- `policy`
- `topology`
- `runtime`
- `order`
- `sql/seed`
- `test/e2e`
- 必要的公共错误码 / repository 事务封装

## 3. 必做项

### 3.1 runtime 边界规则补齐
补齐并真实落库/校验以下场景：
1. `concurrency exceeded`
   - 同一用户在同一时刻只允许 1 个 active/running 会话，或按已有策略字段上限校验。
   - `start-check` 返回 deny，写入结构化 `blockingReasons`。
   - `create session` 二次兜底校验，不能只依赖前置决策。
2. `policy missing`
   - 当 `well_runtime_policy` 缺失且 fallback 链也无法给出可用计费/运行规则时，返回 deny。
   - 输出可识别错误码与 blocking reason。
3. `decision expired`
   - `runtime_decision` 必须带过期时间。
   - 仅允许基于未过期且 `result=allow` 的决策创建会话。
4. `session not found / session already ended`
   - stop 时明确区分：不存在、非当前用户可见、已结束、不可停止。
   - 统一映射到稳定错误码。

### 3.2 EffectivePolicyResolver fallback 真正参与合并
把以下策略源从“占位预留”提升到“真实只读 fallback 参与计算”：
- `interaction_policy`
- `scenario_template`
- `device_type_default`

要求：
- 仍保持固定优先级：
  `well_runtime_policy > pump_valve_relation > interaction_policy > scenario_template > device_type_default`
- 调用方不能覆盖优先级。
- 合并结果必须保留来源快照，例如：
  - `resolved_from.billing_package_source`
  - `resolved_from.max_session_minutes_source`
  - `resolved_from.idle_timeout_seconds_source`
- 输出给 `runtime_decision` 和 `runtime_session` 的策略快照必须可审计、可复算。

### 3.3 runtime_session / irrigation_order 事务一致性
补齐以下一致性要求：
1. 创建会话与创建草稿订单必须在同一事务内提交。
2. stop 会话与结算订单必须在同一事务内提交。
3. 任一步骤失败必须整体回滚，不能出现：
   - session 已 ended 但 order 仍 active 未更新
   - order 已 completed 但 session 仍 running
4. repository 层需提供显式事务封装，不允许 service 层各自分散提交。

### 3.4 stop 幂等性
同一 `runtime_session` 重复 stop：
- 第一次成功：正常结算并返回 ended/completed
- 第二次及后续：
  - 不重复生成订单
  - 不重复追加金额
  - 返回稳定响应（推荐 200 + 已结束状态，或既有异常码但不得重复副作用）

### 3.5 pricePreview / blockingReasons / availableActions 收紧
`POST /u/runtime/start-check` 的输出继续保持真实值，但要进一步标准化：
- `blockingReasons`：数组内元素必须结构化，至少含 `code`、`message`
- `availableActions`：deny 时只能返回前端可执行动作，例如 `contact_support`、`retry_later`
- `pricePreview`：
  - allow 时返回真实预览
  - deny 时返回 `null` 或冻结契约允许的空值语义
  - free / flat / duration 三种模式都要可区分

## 4. 建议文件落点

### policy
- `src/modules/policy/policy.repository.ts`
- `src/modules/policy/effective-policy.resolver.ts`
- `src/modules/policy/policy.dto.ts`（仅内部结构补充，不改对外契约）

### runtime
- `src/modules/runtime/runtime.repository.ts`
- `src/modules/runtime/runtime.service.ts`
- `src/modules/runtime/runtime.dto.ts`（仅内部结构补充，不改对外契约）

### order
- `src/modules/order/order.repository.ts`
- `src/modules/order/order.service.ts`

### 公共层
- `src/common/errors/error-codes.ts`
- `src/common/errors/app-exception.ts`
- 如需要：数据库事务 helper

### seed / test
- `sql/seed/001_phase1_demo.sql`
- `test/runtime-order.e2e-spec.ts`
- 如拆分：新增 `runtime-guards.e2e-spec.ts`

## 5. 新增/补齐测试场景

### e2e 必须覆盖
1. 正常启动
2. 拓扑阻断
3. 策略阻断（policy missing）
4. 决策过期
5. 并发超限
6. 正常停止并生成订单
7. stop 幂等（重复 stop 不重复结算）
8. session not found

### 断言重点
- 所有 runtime 三个 POST 仍返回 `200`
- 错误场景返回冻结契约可消费的业务体，而不是未处理 500
- `runtime_session` 与 `irrigation_order` 状态最终一致
- 订单金额由后端计算，前端不需要参与

## 6. Seed 补充要求
新增至少以下数据样本：
1. `policy missing` 样本井
2. `disabled/offline` 拓扑样本井
3. 可正常启动并可停止结算的 happy-path 样本井
4. 可触发并发超限的用户样本
5. 可触发 fallback 合并的样本（没有井级策略，但能从 interaction/template/default 拿到规则）

## 7. 验收标准
满足以下条件才算 Codex-03B 完成：
- `npm run build` 通过
- `npm run db:migrate:reset` 通过
- `npm run db:seed` 通过
- `npm run test:e2e -- --runInBand` 全通过
- 本地联调时：
  - start-check 能稳定给出 allow/deny 与真实原因
  - create-session 不接受过期或 deny 决策
  - stop 不会重复结算
  - session/order 最终状态一致

## 8. 明确不做
- 不改 OpenAPI v1
- 不新增页面
- 不接设备控制闭环
- 不接 JWT / RBAC
- 不做 AI 网关实现
- 不做退款 / 异常订单 / 人工复核流
- 不做告警 / 工单复杂流转

## 9. 推荐实施顺序
1. 先补错误码与结构化 blocking reason
2. 再补 decision 过期与 create-session 二次兜底
3. 再补 concurrency 校验
4. 再补 fallback 策略真实合并
5. 最后收口事务一致性与 stop 幂等
6. 补 seed 与 e2e

## 10. 交付物
- 代码变更
- 更新后的 seed
- e2e 结果截图或日志
- 一份简短变更清单：
  - 新增错误码
  - 新增测试场景
  - 事务/幂等处理方式
  - fallback 合并字段来源说明
