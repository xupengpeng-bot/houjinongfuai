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
  - `COD-2026-03-27-035`（**全量收口**：含资产/设备空间 manual·reported·effective 读模型）
- mode
  - **`BACKEND`**
- status
  - **`fixed`**
- changed files / synced files
  - **`backend/src/common/location/effective-location.ts`**（**`resolveEffectiveLocation`**；**`ASSET_EFFECTIVE_*_SQL`** 与 TS 规则对齐；**`buildSpatialLocationReadModelAsset/Device`**；**`MAP_TRUTH_NOTICE`**）
  - **`backend/src/modules/asset/asset.module.ts`**（资产列表/详情/树：**`reported_*`** 透出；**effective** 按 **`location_source_strategy`** 计算；响应 **`location_read_model`**；策略枚举含 **`auto`**）
  - **`backend/src/modules/device-ledger/device-ledger.repository.ts`**（SQL 不再从 **`ext_json`** 直接读 effective）
  - **`backend/src/modules/device-ledger/device-ledger.service.ts`**（**`enrichLocation`**：**`map_display_latitude/longitude`**、**`location_read_model`**）
  - **`backend/test/unit/effective-location.spec.ts`**、**`backend/test/unit/device-ledger.service.spec.ts`**
  - **`docs/codex/RESULT.md`**
- migration or contract summary
  - **无新 DDL**（资产 **`manual_*`/`reported_*`** 已见于 **`008`**；设备仍以 **`ext_json`+资产** 合并 manual/reported，**effective 仅由后端策略计算**）。
  - **空间真相**：地图/列表默认使用 **`effective_*`** / **`map_display_*`**；**`location_read_model.mapTruthNotice`** 明示 **不得将临时地图画布坐标当持久真相**。
  - **保留前期收口**：泵阀/Topology 边界、**`network_model_version`** 发布态、**solver 仅已发布图** — 未回滚。
- verification result
  - **`npm run build`**：**通过**
  - **`npm run test:unit`**：**通过**（25 tests）
- commit SHA or `no git action`
  - 见本回合 `git log -1`
- frontend impact
  - 资产 **GET** 增加 **`location_read_model`**；设备列表/详情增加 **`map_display_*`**、**`location_read_model`**；**`location_source_strategies`** 选项多 **`auto`**
- pending issues
  - 若需持久化 **effective_* 列** 以便 DB 侧排序，可另开 **`COD`**（本步刻意保持计算型真相）
- next handoff target
  - 前端列表/地图只绑 **`effective`** / **`map_display_*`**；画布仅作编辑草稿直至保存到 manual/reported
