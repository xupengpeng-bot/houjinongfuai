# Dispatch MySQL patches

These SQL files apply to the **MySQL** database that holds `dispatch_task` / `dispatch_team_current` (not the main Postgres `DATABASE_URL`).

- Charset: **utf8mb4**
- Run with your usual MySQL client; credentials stay in env / secrets, not in Git.

## Files

| File | Purpose |
|------|---------|
| `000_dispatch_bootstrap_init.sql` | minimal bootstrap baseline for `dispatch_team_current`, `dispatch_task`, `dispatch_artifact` |
| `001_dispatch_task_hotpath.sql` | COD-032: `summary_json`, `artifact_ref` on `dispatch_task` |
| `002_dispatch_task_sequencing.sql` | COD-034: `next_task_id`, `depends_on_task_id`, `queue_order` on `dispatch_task` |
| `003_dispatch_bootstrap_metadata.sql` | additive bootstrap metadata: `task_type`, `source_of_truth`, `execute_now_md` |

## Write API (backend)

When `DISPATCH_DB_WRITE_ENABLED=true` (and optional `DISPATCH_WRITE_KEY`), Nest exposes:

- `GET /api/v1/dispatch/team/:team/bootstrap` - one-shot bootstrap result with lane state + active task read model
- `POST /api/v1/dispatch/task/:taskId/status` — body may include `auto_activate_next: true` with `status: closed` to atomically close the active task and activate `next_task_id` (next must be `synced_ready` or `draft_local_only`, same team, dependencies closed).
- `POST /api/v1/dispatch/task/:taskId/result-summary`
- `POST /api/v1/dispatch/task/:taskId/sequencing` — set `next_task_id`, `depends_on_task_id`, `queue_order` (JSON `null` clears).

See `backend/src/modules/dispatch-mysql/` for rules (status whitelist, team sync).

## Minimal bootstrap flow

For a new machine or a DB-primary pilot:

1. Apply `000_dispatch_bootstrap_init.sql` on an empty dispatch MySQL database.
2. If the database already exists, apply `001`, `002`, and `003` as needed.
3. Fill at least one `dispatch_team_current` row and one `dispatch_task` row for the active lane.
4. Read bootstrap by either:
   - `GET /api/v1/dispatch/team/:team/bootstrap`
   - `python backend/scripts/dispatch_bootstrap_fetch.py --team software_engineer`

Minimal required bootstrap fields:

- lane row:
  - `team`
  - `status`
  - `active_task_id`
  - `work_mode`
- task row:
  - `task_id`
  - `team`
  - `task_type`
  - `mode`
  - `status`

Recommended additional fields:

- `title`
- `purpose`
- `source_file`
- `summary_json`
- `execute_now_md`
