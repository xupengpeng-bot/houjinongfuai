# Codex / 派单目录（后端仓库）

本目录集中存放 **嵌入式、硬件、前端协作** 的派单与交付物，避免堆在仓库根目录。

| 子目录 | 用途 |
|--------|------|
| `embeddedcomhis/` | 固件 / 嵌入式任务入口（`CURRENT.md`、`RESULT.md`、fixtures） |
| `hardwarecomhis/` | 硬件 / 接口基线任务入口 |
| `lovablecomhis/` | 与前端仓库对齐的少量镜像说明（主派单在 `lovable-working` 的 `docs/codex-dispatch/lovablecomhis/`） |

路径均以 **本仓库根目录** 为基准。更新派单状态时请同步修正各目录内 `README.md` / `CURRENT.md` 中的引用。
