# 行政区划参考库 `region_reference`

## 数据来源

- CSV：`backend/data/region-reference/raw/`（`provinces.csv`、`cities.csv`、`areas.csv`、`streets.csv`、`villages.csv`）
- 导入：`npm run region-reference:import`（`scripts/import-region-reference.ts`）
- 版本与生效日期写入每条记录的 `source_version`、`effective_date` 字段

## 一键「只保留区划、清空其它」

在 `backend` 目录执行（需 Docker 中 PostgreSQL 已启动，且 `.env` 中 `DATABASE_URL` 正确）：

```bash
npm run db:reset:reference-only
```

等价于：`migrate.ps1 -Reset`（重建 schema + 跑齐 migrations）→ 再执行 CSV 全量导入。

## 不变性（不准在库里手改）

- 迁移 `022_region_reference_strict_guard.sql`：`UPDATE` / `DELETE` 会被拒绝。
- 批量导入时在事务内设置 `app.region_reference_guard_disabled = on`（仅本会话），用于 `INSERT ... ON CONFLICT DO UPDATE`。
- 若必须纠偏数据：应更新 CSV、调整版本号后重新跑导入脚本；或在受控会话中临时 `set_config` 后操作（仅限运维脚本，禁止业务接口写入）。

## 与 SQL seed 的关系

- `sql/seed/001a_region_reference.sql` 已改为占位，**不再**插入区划。
- 演示/基线业务数据（项目、资产等）仍由 `db:seed:baseline`、`db:seed:demo` 等可选命令加载；与区划导入相互独立。
