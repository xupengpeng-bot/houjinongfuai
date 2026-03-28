# File-Only Command Protocol

Status: active
Audience: PM, software engineer, embedded engineer, hardware engineer, Lovable
Purpose: let the user trigger work by saying only "execute" to a named team, while all scope, queue state, and return format stay in files.

## Feasibility decision

- This protocol is the default operating mode for this project.
- It is more efficient than repeated chat restatement for stable, repeatable work.
- It remains safe only if PM keeps each team's `CURRENT.md` accurate.
- Lovable execution result is retrieved from Git by default.

## Core rule

- Each team has one live command file: `CURRENT.md`
- Each team has one live return file: `RESULT.md`
- Frontend work also keeps one readable queue board:
  - `../lovable/lovablecomhis/WAVE.md`
- When PM or the user says only `execute`, the named team must:
  1. read its `CURRENT.md`
  2. read the linked task, context, and fixtures
  3. if the team is Lovable, also read `WAVE.md`
  4. execute only the active scope
  5. write back to `RESULT.md` using the fixed format
- Verbal restatement is optional and is not the source of truth.

## Path rule

- Prefer repository-relative paths in all active protocols and task files.
- Treat the current repository root as the backend workspace anchor.
- Treat the real frontend repository as the sibling folder `../lovable` unless PM freezes another location in the active task.

## Team entry files

- software engineer
  - `docs/codex/CURRENT.md`
  - `docs/codex/RESULT.md`
- Lovable
  - `../lovable/lovablecomhis/LOVABLE-PERMANENT-RULES.md`
  - `../lovable/lovablecomhis/CURRENT.md`
  - `../lovable/lovablecomhis/WAVE.md`
  - `../lovable/lovablecomhis/RESULT.md`
- embedded engineer
  - `embeddedcomhis/CURRENT.md`
  - `embeddedcomhis/RESULT.md`
- hardware engineer
  - `hardwarecomhis/CURRENT.md`
  - `hardwarecomhis/RESULT.md`

## PM responsibility

- Update `CURRENT.md` before asking any team to execute.
- Keep only one active task per team unless an explicit queue is documented in a queue board such as `WAVE.md`.
- Mirror any backend, frontend, or protocol context into the target repo before dispatch.
- Keep path references relative to the active repository root whenever possible.
- Mark `paused`, `blocked`, `waiting_sync`, and `waiting_verify` states explicitly.
- Move stale work into archive or historical task files, not into `CURRENT.md`.
- Prefer batch sync for frontend task packages instead of per-task sync when the batch is stable enough.

## RESULT contract

`RESULT.md` must always contain:

1. execution time
2. task id
3. status: `fixed | blocked | paused | waiting_sync | waiting_verify | done_without_change`
4. changed files or artifacts
5. verification result
6. commit SHA, revision, or explicit `no git action`
7. pending issues
8. next handoff target

## Lovable Git rule

- `lovablecomhis/CURRENT.md` is the official execution entry.
- `lovablecomhis/WAVE.md` is the readable queue and batch-state board.
- Lovable implements in the cloud frontend repo and submits through Git.
- PM and software engineer read the resulting commit from Git as the execution truth.
- `lovablecomhis/RESULT.md` can still be used as a readable summary, but Git commit and local pull result are final acceptance evidence.
- If frontend business code is claimed complete but no implementation commit is visible in pulled `main` or confirmed `origin/main`, treat the task as `waiting_sync`, not `fixed`.

## Status rule

- `active`
  - execute now
- `paused`
  - do not execute
- `blocked`
  - wait for upstream baseline
- `waiting_sync`
  - task exists locally but the required repo sync is not complete
- `waiting_verify`
  - implementation claimed complete; local pull and acceptance are not complete
- `closed`
  - PM accepted and removed the item from the active lane
- `superseded`
  - replaced by a newer frozen product rule

## User shortcut

The user only needs to say one of these:

- `软件工程师执行`
- `Lovable 执行`
- `嵌入式工程师执行`
- `硬件工程师执行`
- or plain English equivalents such as `software engineer execute`

PM then points the user to the correct team to notify. The file, not the chat, is the source of truth.
