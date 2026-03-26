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
  - 2026-03-26
- task id
  - `COD-2026-03-26-021`（项目配置搜索与联动契约整批，`BACKEND`）
- status
  - `fixed`
- changed files
  - `backend/src/modules/project-block/project-block.module.ts`
  - `backend/src/modules/metering-point/metering-point.module.ts`
  - `backend/test/e2e/block-metering-contract.e2e-spec.ts`
  - `docs/codex/RESULT.md`、`docs/codex/CURRENT.md`
  - `docs/codex/COD-2026-03-26-021_项目配置搜索与联动契约整批任务.md`
- migration or contract summary
  - **无 DDL**；在既有表上扩展查询参数。
  - **`GET /api/v1/project-blocks/options`**
    - 新增 **`project_id`**：仅返回该项目下区块。
    - 新增 **`q`**：`ilike` 匹配 **区块编码、区块名称、项目名称**。
    - 返回行仍为 **`value` / `label` / `block_code` / `project_id` / `project_name`**；`join project` 增加 **`p.tenant_id = pb.tenant_id`** 约束。
  - **`GET /api/v1/metering-points/form-options`**
    - 新增 **`q`**（与既有 **`project_id`** 可组合）：
      - **`projects`**：按 **`project_name` / `project_code`** 搜索；响应行增加可选元数据 **`region_id`**（`::text`）。
      - **`blocks`**：在 **`project_id`** 收窄（若有）基础上，按 **`block_name` / `block_code`** 搜索。
      - **`assets`**：同上，按 **`asset_name` / `asset_code`** 搜索。
      - **`devices`**：在 **`project_id`** 存在时，将 **`device.region_id`** 与 **`project.region_id`** 对齐以收窄候选（同区域设备）；**`q`** 匹配 **`device_code` / `device_name` / `serial_no`**。无 **`project_id`** 时仍为租户级列表（limit 500）。响应行增加 **`region_id`**。
    - **`point_types` / `statuses`** 保持不变。
- verification result
  - **`npm run build`**：通过。
  - **`npm run test:unit`**：通过。
  - **e2e**：`block-metering-contract` 在 **`E2E_WITH_DB=1`** 时增加对 **`q`** 的烟测（`015/018/021` 描述已更新）。
- commit SHA or `no git action`
  - `no git action`（工作区未由本助手提交；仓库 `HEAD` 仍为 `d88bb7ed87644187c4a9fa5650b41f021a4ec138`）
- frontend impact
  - **无前端业务代码变更**（符合 `CURRENT.md`）。前端可在 **`useMeteringPointFormOptions({ project_id })`** 等 hook 中改为带 **`project_id` / `q`** 调用以完成区块联动与搜索型选择器。
- pending issues
  - **`devices` 按项目收窄** 采用 **区域对齐**（`device.region_id` = `project.region_id`），若存在跨区设备挂载需求需后续拓扑或挂载表驱动。
  - 超大列表仍依赖 **`limit 500`** 与客户端搜索；若需分页需另开任务。
- next handoff target
  - 前端在 **`MeteringPointFormDialog`** 等：在切换项目时请求 **`/metering-points/form-options?project_id=...`**（可加 **`q`**），并视需要为 **`/project-blocks/options`** 增加相同参数；完成后可关闭 LVB-4022 残留联动项。
