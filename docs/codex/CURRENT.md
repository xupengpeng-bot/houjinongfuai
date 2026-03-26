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
  - `COD-2026-03-26-013` fixed — block / metering-point / network-model / data-scope skeleton + solver contract skeleton
  - `COD-2026-03-26-014` fixed — `LVB-4020` handoff synced to frontend Git `main`
  - `COD-2026-03-26-015` fixed — real backend contracts for `project-blocks` and `metering-points`
  - `COD-2026-03-26-016` fixed — `LVB-4021` handoff synced to frontend Git `main`
  - `COD-2026-03-26-017` fixed — `LVB-4021` local re-verify passed
  - `COD-2026-03-26-018` fixed — backend compatibility layer added for `LVB-4021`
  - `COD-2026-03-26-019` fixed — `LVB-4022` handoff synced to frontend Git `main`
  - `COD-2026-03-26-020` fixed — `LVB-4022` local acceptance passed for the first-batch interaction scope
  - `COD-2026-03-26-021` fixed — searchable options and project-linked filtering contract batch completed locally
  - `COD-2026-03-26-022` fixed — `COD-021` 后端已推送 `main` `3a556e9`（见 `docs/codex/RESULT.md`）
- active task
  - none

## Work mode

- paused（等待 PM 下一项）

## Read order

1. `AGENTS.md`
2. `docs/codex/CURSOR-ONBOARDING.md`
3. `docs/codex/CURRENT.md`
4. `docs/codex/WORK-MODES.md`
5. `docs/governance/file-only-command-protocol.md`
6. `docs/governance/delivery-workflow.md`
7. `docs/governance/current-wave-2026-03-24.md`
8. `docs/codex/COD-2026-03-26-022_后端021代码提交到Git主线任务.md`
9. `docs/codex/RESULT.md`

## Allowed working area

- `D:\20251211\zhinengti\houjinongfuai\backend`
- `D:\20251211\zhinengti\houjinongfuai\docs`

Do not modify other directories unless PM updates this file.

## Execute now

- 等待 PM 在本文档写入下一项 `active task` 与 `Execute now`

## Hard constraints

- Do not reopen architecture.
- Do not modify frontend business code.
- Do not mix unrelated worktree changes into this commit.

## Result writeback

After each execution, update `docs/codex/RESULT.md` using the fixed format in the protocol file.
