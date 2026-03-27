# Codex Result

Status: active-template
Audience: Codex and PM
Purpose: overwrite the latest-result section after each execution. Keep the field order stable.

## Required format

1. execution time
2. task id
3. status
4. changed files
5. migration or contract summary
6. verification result
7. commit SHA or `no git action`
8. frontend impact
9. pending issues
10. next handoff target

## Latest result

- execution time
  - 2026-03-27
- task id
  - `COD-2026-03-27-020`（项目 / 区块**数据权限**后端第一批）
- mode
  - **`EXECUTE`**
- status
  - **`fixed`**
- changed files / synced files
  - **`backend/src/modules/policy/`**：新增 `data-scope.dto.ts`、`data-scope.resolve.ts`、`data-scope.repository.ts`、`data-scope.service.ts`、`data-scope.controller.ts`；更新 `policy.module.ts`
  - **`backend/test/unit/data-scope-merge.spec.ts`**
  - **`docs/codex/CURRENT.md`**、**`docs/codex/RESULT.md`**、**`docs/codex/COD-2026-03-27-020_项目区块数据权限第一批任务.md`**
- migration or contract summary
  - **无新 DDL**（沿用 `data_scope_policy` 表，见 migration `015_block_metering_network_scope_solver.sql`）。
- verification result
  - **`npm run build`**：**通过**
  - **`npm run test:unit`**：**通过**（含 `mergeProjectBlockScope` 纯函数用例）
- commit SHA or `no git action`
  - 见本回合 `git log -1`
- frontend impact
  - **新增只读契约（additive）**，供后续前端下拉 / 筛选使用（当前未改前端业务代码）：
    - **`GET /ops/data-scope/summary`**：`tenantId`、`userId` 可选 query，缺省为 Phase 1 与 **`GET /auth/me`** 一致的 demo 身份
    - **`GET /ops/data-scope/projects`**：可见项目选项
    - **`GET /ops/data-scope/blocks`**：可见区块选项；可选 **`projectId`** 过滤
  - **合并规则（摘要）**：`effect=allow` 且 `subject` 为当前用户或其角色；`scope_type=project` → 该项目下**全部**区块；`scope_type=block` → 仅该区块，且其父项目出现在项目选项中；**`tenant_admin` 且无任何 `data_scope_policy` 行** → 租户内项目 / 区块**全量**（隐式全目录，保守替代为「无策略则空」仅适用于非管理员）。
- pending issues
  - 真实 JWT / 请求上下文接入后，应去掉 query 默认值，改为从认证解析 `tenantId` / `userId`。
  - `effect=deny` 与多条策略冲突时的优先级未实现（当前仅消费 `allow`）。
- next handoff target
  - 前端：对接 **`/ops/data-scope/*`** 做项目 / 区块筛选与页面级 scope 提示；或下一批后端在业务查询中复用 **`DataScopeService`**。
