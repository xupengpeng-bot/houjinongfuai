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
  - `COD-2026-03-27-035`（边界收口：泵阀 manual/reported/effective 真相 + 已发布网模 + solver 绑定）
- mode
  - **`BACKEND`**
- status
  - **`fixed`**（本包按「边界收口」验收，不仅是字段/stub）
- changed files / synced files
  - **`backend/sql/migrations/020_network_model_version_publish.sql`**（**`published_at`**、每模型最多一个 **`is_published`** 部分唯一索引；演示行 **`…a11`** 置为已发布）
  - **`backend/sql/seed/004_block_metering_network_skeleton.sql`**（演示 **`network_model_version`** 默认已发布；依赖 **`020`** 已执行）
  - **`backend/src/modules/topology/pump-valve-topology-read-model.ts`**（**`PUMP_VALVE_TOPOLOGY_STATE`** 后端真相位置；**`pump_valve_relation_v1`** 与 **`topology_relation` 设备边** 显式不合并）
  - **`backend/src/modules/topology/topology.repository.ts`**（列表增加 **`pumpValveTopologyReadModel`**）
  - **`backend/src/modules/network-model/*`**（**`GET /ops/network-models/:id/published-version`**、**`POST .../versions/:vid/publish`**）
  - **`backend/src/modules/solver/solver.dto.ts`**（**`SOLVER_CONTRACT_VERSION=solver-v2-published-network`**；**preview/plan** 必填 **`network_model_version_id`**）
  - **`backend/src/modules/solver/solver.service.ts`**（仅接受 **已发布** 版本；**`readModel.networkGraphSnapshot`** 来自 **`network_node`/`network_pipe` 计数**，非画布 JSON）
  - **`backend/test/unit/pump-valve-topology-read-model.spec.ts`**、**`backend/test/e2e/solver-contract.e2e-spec.ts`**（e2e **`ensurePublishedNetworkGraph`**）
  - **`docs/codex/RESULT.md`**
- migration or contract summary
  - **泵阀**：三层均落在 **`pump_valve_relation.topology_relation_type_state`**（jsonb 键 **`manual`/`reported`/`effective`**）；列表除标量外返回完整 **`pumpValveTopologyReadModel`**（含 **`storage`**、**`notMergedWith`**）。
  - **网模**：**`published_at`** + **单模型单发布**索引；发布 API 原子切换发布行。
  - **Solver**：**preview/plan** 必须带 **`network_model_version_id`** 且对应行 **`is_published=true`**，否则 **400**；**`readModel.networkGraphSnapshot`** 标识 **`source: database`**。
- verification result
  - **`npm run build`**：**通过**
  - **`npm run test:unit`**：**通过**（21 tests）
  - **`solver-contract` e2e**：**通过**
- commit SHA or `no git action`
  - 见本回合 `git log -1`
- frontend impact
  - **Breaking**：solver **preview/plan** 请求体必须含 **`network_model_version_id`**（已发布）；**`contractVersion`** 升级为 **`solver-v2-published-network`**
- pending issues
  - 新环境须先 **`019`** 再 **`020`** 再跑含 **`published_at`** 的 seed
- next handoff target
  - 前端对接 **`GET /ops/network-models/.../published-version`** 与发布按钮；solver 真求解仍后续批次
