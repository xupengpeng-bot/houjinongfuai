# Project Execution Rules

## Scope

- Repository: the currently opened repository root
- Current phase: `Phase 1`
- Development-system docs for this project are maintained in the sibling workspace:
  - `D:\20251211\zhinengti\development-system\projects\houjinongfuai`
- Treat that sibling workspace as the source for:
  - onboarding
  - dispatch
  - work modes
  - governance
  - task-system rules
- Treat this repository as the business-code workspace.

## Fixed boundaries

- Do not reopen architecture discussions.
- Frontend may call NestJS API only through `fetch`.
- Supabase is only the database host and must not carry business logic.
- Frontend must not read or write business data through `supabase-js`.
- Runtime, billing, security, audit, and device command routing are backend responsibilities.
- AI must not directly control devices.

## Backend implementation principles

- Current priority:
  - `real integration stability > mainline/UAT closure > device protocol/simulator connectivity > object layer and alert/work-order deepening`
- Compatibility patches are allowed only for path names, field names, response envelopes, error codes, and old contract residue. They must not change business rules.
- All critical paths must be auditable, idempotent, and replayable.
- Prioritize fund safety before experience polish.
- When uncertain, choose the more conservative, safer, and easier-to-trace option.

## Phase 1 first-batch constraints

- Allowed changes only:
  - documents
  - state machines
  - DDL / migration
  - test skeletons
  - protocol simulator skeletons
- Do not change the actual runtime semantics of:
  - `/u/scan`
  - `/u/session`
  - `/u/history`
  - `/ops/orders`
  - `/ops/sessions`
- New data structures must be additive-compatible and must not overturn existing `runtime_session` or `irrigation_order`.
- Table names and model names must align with the repository's current canonical schema.
- The primary device entity is `device`.

## Device and fund rules

- Device business primary key: `IMEI`
- OTA/device command short-code rule:
  - OTA and device-side realtime commands must use short codes when talking to embedded devices.
  - Do not introduce or prefer long-form OTA command/query names in device-facing instructions, payload examples, or protocol changes.
  - Current OTA short codes are:
    - `upg` for upgrade action
    - `qgs` for upgrade-status query
    - `qgc` for upgrade-capability query
  - When discussing OTA with embedded-side AI or firmware engineers, always describe the interaction using short codes first.
- Connection conflict policy:
  - a new connection with the same `IMEI` replaces the old connection
  - an audit log must be recorded
- Message idempotency key priority:
  - first choice: `imei + msg_id`
  - second choice: `imei + seq_no + msg_type`
- Unified order semantics:
  - `order_channel = CARD | QR`
  - `funding_mode = CARD_HOLD | QR_PREPAID`
  - `settle_basis = TIME | ENERGY | FLOW`
  - `usage_source = DEVICE_COUNTER`
  - `device_key = IMEI`
- `pricing_package_snapshot` must be frozen at order creation time.

## Device event attribution

- Attribution priority:
  1. `command_id`
  2. `start_token`
  3. `session_ref`
  4. single active session fallback under the same `IMEI`
- If attribution cannot be made uniquely, do not guess for billing. Route it into audit / manual review.

## Collaboration boundary

- Do not directly modify frontend business pages, business hooks, or business services.
- If frontend cooperation is required, dispatch only through the **frontend** repository path `docs/codex-dispatch/lovablecomhis/` (task markdown, `context/`, `fixtures/`), not ad-hoc edits to business pages.
- If there is no frontend task, do not output Lovable instructions.

## UAT test data cleanup rule

- Old UAT and demo data must not remain in the system after verification closes.
- Foundational master data that powers administrative drop-down selection must not be deleted by UAT cleanup:
  - `region_reference`
- The cleanup scope includes at least:
  - business `region`
  - `device_type`
  - `device`
  - device relations and topology test rows
  - session / order / alert / work-order UAT rows
  - temporary `project` / `asset` test rows
  - UAT case / execution rows
- Standard cleanup entry:
  - `cd backend`
  - `npm run testdata:cleanup`
- Closing a UAT verification without test-data cleanup is not allowed.
