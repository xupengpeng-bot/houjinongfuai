# Dispatch MySQL patches

These SQL files apply to the **MySQL** database that holds `dispatch_task` / `dispatch_team_current` (not the main Postgres `DATABASE_URL`).

- Charset: **utf8mb4**
- Run with your usual MySQL client; credentials stay in env / secrets, not in Git.

## Files

| File | Purpose |
|------|---------|
| `001_dispatch_task_hotpath.sql` | COD-032: `summary_json`, `artifact_ref` on `dispatch_task` |

## Write API (backend)

When `DISPATCH_DB_WRITE_ENABLED=true` (and optional `DISPATCH_WRITE_KEY`), Nest exposes:

- `POST /api/v1/dispatch/task/:taskId/status`
- `POST /api/v1/dispatch/task/:taskId/result-summary`

See `backend/src/modules/dispatch-mysql/` for rules (status whitelist, team sync).
