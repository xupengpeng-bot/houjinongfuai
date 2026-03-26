# Cursor Current

Status: active
Audience: Cursor
Purpose: this is the only live execution entry for Cursor. When PM or the user says only "execute", read this file first.

## Current state

- completed tasks
  - `COD-2026-03-24-001` fixed at commit `24531e49f3367f68f5405c8023968e0aabf97196`
  - `COD-2026-03-24-002` fixed at commit `0ae8fddd7c7f3f5187e42b72dcdf08e5452cb128`
  - `COD-2026-03-24-004` fixed at commit `a8090f0`
  - `COD-2026-03-24-005` fixed
  - `COD-2026-03-24-006` fixed at frontend Git `HEAD` `e0a362c2aed3ec3853b8e95fd4a6fa74b3cdecee`
  - `COD-2026-03-24-007` fixed at frontend Git `HEAD` `90c9b14`
  - `COD-2026-03-24-008` fixed at frontend Git `HEAD` `e75ce826f619c0fa9c4a830471d2646195ea60ce`
  - `COD-2026-03-24-009` fixed at frontend Git `HEAD` `c0077dd5f0d94143d61347dd082edcfc72723452`
  - `COD-2026-03-24-010` fixed at frontend Git `HEAD` `cfbb0a3d66f131a5634509bbb5536c4d04e62b5a`
  - `COD-2026-03-24-003` fixed for `LVB-4016` local acceptance at frontend Git `HEAD` `b9af08cd6542c8a17972264f3e3268391605bef5`
  - `COD-2026-03-24-003` fixed for `LVB-4017` local acceptance at frontend Git `HEAD` `2e2ed374a5a958c7f5edc74c786656a9897c361a`
  - `COD-2026-03-24-003` fixed for `LVB-4018` local acceptance at frontend Git `HEAD` `55ff8805604f0a218fcde1d4f32ddcc85773e9f6`
  - `COD-2026-03-26-013` fixed block / metering-point / network-model / data-scope skeleton + solver contract skeleton
  - `COD-2026-03-26-014` fixed `LVB-4020` handoff synced to frontend Git `main`
  - `COD-2026-03-26-015` fixed real backend contracts for `project-blocks` and `metering-points`
  - `COD-2026-03-26-016` fixed `LVB-4021` handoff synced to frontend Git `main`
  - `COD-2026-03-26-017` fixed `LVB-4021` local re-verify passed
  - `COD-2026-03-26-018` fixed backend compatibility layer added for `LVB-4021`
  - `COD-2026-03-26-019` fixed `LVB-4022` handoff synced to frontend Git `main`
  - `COD-2026-03-26-020` fixed `LVB-4022` local acceptance passed
  - `COD-2026-03-26-021` fixed searchable options and project-linked filtering contract batch completed locally and pushed
  - `COD-2026-03-26-022` fixed backend 021 code pushed to Git main
  - `COD-2026-03-26-023` fixed `LVB-4023` handoff synced to frontend Git `main`
  - `COD-2026-03-26-024` fixed `LVB-4023` local acceptance passed
  - `COD-2026-03-26-025` fixed `LVB-4024` handoff synced to frontend Git `main`
  - `COD-2026-03-26-026` fixed `LVB-4024` local acceptance passed
  - `COD-2026-03-26-027` fixed cockpit backend aggregation first batch completed
  - `COD-2026-03-26-028` fixed `LVB-4025` handoff synced to frontend Git `main`
  - `COD-2026-03-26-029` fixed `LVB-4025` local acceptance partial
  - `COD-2026-03-26-030` fixed `LVB-4026` handoff pushed to frontend Git `main`
  - `COD-2026-03-26-031` partial `LVB-4026` VERIFY
  - `COD-2026-03-26-032` fixed cockpit backend aggregation enlarged for one-shot frontend closure
  - `COD-2026-03-26-033` fixed `LVB-4027` handoff synced to frontend Git `main`
  - `COD-2026-03-26-035` fixed `LVB-4028` handoff synced to frontend Git `main`
  - `COD-2026-03-27-001` fixed `LVB-4028` local verify passed
  - `COD-2026-03-27-002` fixed cockpit run-monitor / alert-center / history-replay backend aggregation first batch
  - `COD-2026-03-27-003` fixed `LVB-4029` handoff synced to frontend Git `main`
  - `COD-2026-03-27-004` recorded `LVB-4029` local verify at frontend Git `HEAD` `2b72a05d7ef5d6cef03a75dae396c443edaabf35` — **partial**; DTO mismatch with `COD-2026-03-27-002` (see `RESULT.md`)
- active task
  - none

## Work mode

- IDLE

## Read order

1. `AGENTS.md`
2. `docs/codex/CURSOR-ONBOARDING.md`
3. `docs/codex/CURRENT.md`
4. `docs/codex/WORK-MODES.md`
5. `docs/governance/file-only-command-protocol.md`
6. `docs/governance/delivery-workflow.md`
7. `docs/governance/current-wave-2026-03-24.md`
8. `docs/codex/COD-2026-03-27-004_LVB-4029前端本地验收任务.md`（已关闭；结果见 `RESULT.md`）
9. `docs/codex/RESULT.md`

## Allowed working area

- `D:\20251211\zhinengti\houjinongfuai\docs`
- `D:\20251211\zhinengti\lovable`

Do not modify other directories unless PM updates this file.

## Execute now

- PM must update this file before the next dispatch.

## Hard constraints

- Do not reopen architecture.
- Do not modify frontend business code.
- Verify only. Do not patch frontend business code during acceptance.

## Result writeback

After each execution, update `docs/codex/RESULT.md` using the fixed format in the protocol file.
