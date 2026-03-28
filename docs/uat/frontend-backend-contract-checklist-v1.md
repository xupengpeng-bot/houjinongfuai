# Phase 1 Frontend / Backend Contract Checklist

Status: current  
Scope: Phase 1 real integration and UAT smoke  
Rule: list current page needs first, then map to existing backend reads, then record remaining gaps without expanding business scope.

## Canonical rule

- Keep current frozen API boundary as the canonical external contract.
- Existing farmer aliases such as `/farmer/wells/:id/start-check` and `/farmer/wells/:id/sessions` are treated as compatibility adapters during the real integration period.
- Runtime and billing semantics remain unchanged in this round.

## Farmer pages

| Page | Primary view fields | Detail / follow-up fields | Current backend endpoint | Seed data stable | Current status | Notes |
|---|---|---|---|---|---|---|
| `/u/scan` | `result`, `blockingReasons`, `availableActions`, `pricePreview.billingMode`, `pricePreview.unitPrice`, `pricePreview.unitType`, `pricePreview.currency` | `decisionId`, action availability for `START_SESSION` | `POST /api/v1/u/runtime/start-check` and compatibility alias `POST /api/v1/farmer/wells/:id/start-check` | Yes | Available | S01 allow, S03 deny, S04 deny, S05 allow are fixed by seed and tests |
| `/u/session` | `id`, `well_name`, `status`, `usage`, `unit`, `duration_minutes`, `cost`, `billing_package`, `unit_price` | stop action result and redirect to history | `GET /api/v1/farmer/session/active`, `POST /api/v1/u/runtime/sessions/{id}/stop` and compatibility alias `POST /api/v1/farmer/sessions/{id}/stop` | Yes | Available | Happy path verified through UAT smoke |
| `/u/history` | `id`, `well`, `billing`, `start_time`, `end_time`, `usage`, `unit`, `amount`, `status` | current frontend only uses list cards | `GET /api/v1/u/orders` and compatibility alias `GET /api/v1/farmer/orders` | Yes | Available | Shows seeded completed and active-to-completed history after stop |

## Ops pages

| Page | Primary list fields | Detail / follow-up fields | Current backend endpoint | Seed data stable | Current status | Notes |
|---|---|---|---|---|---|---|
| `/ops/orders` | `id`, `user`, `well`, `billing`, `start_time`, `end_time`, `usage`, `unit`, `amount`, `status` | `GET /orders/:id` exists but current page is list-first | `GET /api/v1/orders` | Yes | Available | Backend already maps order status to `active` / `completed` for current page |
| `/ops/sessions` | `id`, `well`, `user`, `start_time`, `flow`, `duration`, `status` | current page is list-first | `GET /api/v1/run-sessions` | Yes | Available | Running and ended sessions both present in seed |
| `/ops/devices` | `sn`, `name`, `type`, `area`, `well`, `status`, `last_report` | `GET /devices/:id` exists but page is list-first | `GET /api/v1/devices` | Yes | Available | Seed provides baseline devices including S01 and S08 |
| `/ops/wells` | `id`, `name`, `area`, `depth`, `pump_model`, `daily_usage`, `monthly_usage`, `status` | `GET /wells/:id` exists but page is list-first | `GET /api/v1/wells` | Yes | Available | Seed provides 7 wells across S01-S08 |
| `/ops/pump-valve` | `id`, `well`, `pump`, `valve`, `sequence`, `valve_delay`, `pump_delay`, `status` | current page is list-first | `GET /api/v1/pump-valve-relations` | Yes | Available | S08 relation used as fallback source reference |
| `/ops/alerts` | `id`, `device`, `type`, `level`, `area`, `time`, `desc`, `status` | `GET /alerts/:id`, `PATCH /alerts/:id` exist | `GET /api/v1/alerts` | Yes | Available | Pending / processing / resolved all present in seed |
| `/ops/work-orders` | `id`, `title`, `type`, `priority`, `area`, `assignee`, `deadline`, `status` | `GET /work-orders/:id` exists, action endpoints exist | `GET /api/v1/work-orders` | Yes | Available with known frontend mapping gap | Backend returns `created`, `assigned`, `in_progress`, `completed`, `closed`; current frontend only labels part of them |
| `/ops/uat` | `id`, `module`, `scenario`, `steps`, `passed`, `status`, `tester`, `date` | executions endpoint exists separately | `GET /api/v1/uat/cases` | Yes | Available | Uses seeded UAT cases and executions |
| `/ops/users` | `id`, `name`, `username`, `role`, `area`, `phone`, `status` | `GET /system/roles` and `GET /system/permissions` exist if needed later | `GET /api/v1/system/users` | Yes | Available with known frontend display gap | Backend returns `active` / `disabled`; current page hardcodes status display |
| `/ops/dashboard` | `total_wells`, `running_wells`, `total_devices`, `online_devices`, `today_orders`, `today_usage`, `today_revenue`, `pending_alerts`, `open_work_orders`, `monthly_usage`, `monthly_revenue`, `device_online_rate` | current page is card-only | `GET /api/v1/dashboard/stats` | Yes | Available | Aggregates seeded data; response also mirrors top-level stats for compatibility |

## Current gaps

### A. Backend already fixed and verified

- Farmer runtime chain aliases remain available while canonical runtime endpoints stay unchanged.
- Dashboard stats response is safe for current page consumption.
- Alert list path and status mapping are stable under current seed.
- Fallback source chain for S08 is explicit and test-covered.

### B. Backend already capable, but frontend still needs adaptation

- `/u/scan`
  - Current frontend still uses compatibility farmer alias paths instead of canonical `/u/runtime/*`.
  - Not blocking now because backend adapter exists.
- `/ops/work-orders`
  - Backend returns the full seeded lifecycle: `created`, `assigned`, `in_progress`, `completed`, `closed`.
  - Current frontend only renders labels for a subset of these statuses.
  - Not a backend blocker, but it affects display completeness.
- `/ops/users`
  - Backend returns `status`.
  - Current frontend currently renders a fixed status badge instead of using the field.
- `/u/session`
  - Backend returns actual session values.
  - Current frontend still shows a fixed idle timeout hint instead of reading server policy data.

### C. Explicitly left to a later stage

- Device event driven runtime/order behavior
- Real card hold / prepaid / refund execution semantics
- Protocol simulator to runtime ingest integration
- Real payment or card system integration
- Rich detail pages beyond the current list/card surfaces

## UAT note

The current seed plus backend reads are sufficient for deterministic real integration demos of:

- farmer happy path: scan -> session -> stop -> history
- ops list visibility: orders, sessions, devices, wells, pump-valve, alerts, work-orders, uat, users, dashboard

This checklist does not authorize new business features. It only records the current contract closure and remaining gaps.
