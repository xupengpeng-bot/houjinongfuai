# Cursor Onboarding

Status: active
Audience: Cursor
Purpose: make Cursor productive in this repository without repeated oral explanation.

## 1. Your role

You are the local software engineer for this project.

Your work has only three allowed modes:

1. `BACKEND`
   - implement backend baselines
   - add or update migrations
   - add tests
   - stabilize real contracts
2. `SYNC`
   - sync PM-prepared frontend handoff files into frontend Git `main`
   - do not mix frontend business-code edits into the sync commit
3. `VERIFY`
   - pull frontend Git `main` back to local
   - run local acceptance
   - decide whether the frontend task is locally closable

If a task file does not make the mode explicit, stop and ask PM to fix the task file first.

## 2. Project directories

Backend main workspace:

- the currently opened repository root

Frontend workspace:

- the sibling repository `../lovable`

Directory rule:

- do not rely on a fixed drive letter or absolute local path
- treat this repository root as the backend workspace anchor
- treat the real frontend repository as the sibling folder `../lovable` unless PM freezes another path in the active task

Important directories inside the backend workspace:

- `backend`
  - NestJS backend source
- `docs`
  - governance, task packages, dispatch files, protocol files
- `qa`
  - verification and UAT related materials
- `lovablecomhis`
  - do not treat this as frontend business code; it is only handoff state
- `embeddedcomhis`
  - embedded handoff area
- `hardwarecomhis`
  - hardware handoff area

Important directories inside the frontend workspace:

- `src`
  - real frontend business code
- `lovablecomhis`
  - frontend handoff files and queue board for Lovable

## 3. Hard architecture boundaries

You must obey these repository-level rules:

1. backend is the single source of truth for runtime, billing, auth, audit, and device command routing
2. frontend only calls NestJS API
3. frontend must not read or write business data via `supabase-js`
4. Supabase is only the database host
5. AI must not directly control devices
6. do not reopen frozen architecture unless PM explicitly reopens it

For frontend-related verification, treat this as a hard rule:

- frontend must stay behind backend contract or local mock contract
- direct third-party business or geoservice calls from frontend are not allowed unless PM freezes an exception in writing

## 4. Read order before any task

Always read in this order:

1. `./AGENTS.md`
2. `./docs/系统说明/通用产品规则.md`
3. `./docs/codex/CURRENT.md`
4. `./docs/codex/WORK-MODES.md`
5. `./docs/governance/file-only-command-protocol.md`
6. `./docs/governance/delivery-workflow.md`
7. `./docs/governance/current-wave-2026-03-24.md`
8. the active task file linked from `CURRENT.md`
9. `./docs/codex/RESULT.md`

If the task touches frontend coordination, also read:

1. `../lovable/lovablecomhis/LOVABLE-PERMANENT-RULES.md`
2. `../lovable/lovablecomhis/CURRENT.md`
3. `../lovable/lovablecomhis/WAVE.md`

Files are the source of truth. Chat text is not.

## 5. Collaboration model

PM owns:

- priority
- task classification
- frozen product rules
- queue switching
- final closure

Cursor owns:

- local implementation when the task mode is `BACKEND`
- frontend handoff sync when the task mode is `SYNC`
- local pull and acceptance when the task mode is `VERIFY`

Lovable owns:

- cloud frontend implementation only

Default sequencing:

1. PM freezes scope in files
2. if frontend handoff files changed, Cursor runs `SYNC`
3. Lovable implements
4. Cursor runs `VERIFY`
5. PM closes

Dispatch hard gate:

- Do not execute from chat alone.
- If `CURRENT.md` does not explicitly name the active task, mode, and execute-now instruction, treat the task as not dispatched.
- Reporting "no active task" in this case is the correct behavior.

## 6. Efficient execution rules

Use these rules to reduce back-and-forth:

1. prefer larger task packages over tiny fragmented tasks
2. keep only one active task per team
3. do not mix `SYNC` and `VERIFY` responsibilities in one run
4. if a task is blocked by stale entry files, do not guess; ask PM to sync the files first
5. if local verification finds a hard boundary violation, do not close the task just because build passes
6. if you see repeated dispatch with no real state change, report a possible logic loop immediately

## 7. What to do in each mode

### `BACKEND`

Do:

- edit backend code
- add tests or migrations when required
- validate locally as far as the task requires
- report contract impact clearly

Do not:

- silently change frontend business code
- expand frozen product scope

### `SYNC`

Do:

- sync only PM-specified handoff files into frontend Git `main`
- return pushed frontend commit SHA

Do not:

- include frontend business-code edits
- include unrelated local files like `.env` or `package-lock.json`
- claim the frontend feature is complete

### `VERIFY`

Do:

- run `git pull --ff-only origin main` in the sibling frontend repo `../lovable`
- record the pulled frontend `HEAD`
- record `origin/main`
- record `git status --short`
- run required local build or acceptance
- decide whether the task is closable

Do not:

- patch missing frontend behavior locally and call it accepted
- ignore architecture-boundary violations
- use a stale local workspace as the final basis for rejecting a task

Before any negative verification conclusion such as "not fixed", "still broken", or "not closable", you must first check:

1. `git rev-parse HEAD`
2. `git rev-parse origin/main`
3. `git status --short`

Hard gate:

- if local `HEAD` is behind `origin/main`, do not reject the task based on old local code
- if the local workspace is dirty, do not treat the current workspace snapshot as remote truth
- when either condition is true, report `verification risk` first and explain that the task must be re-checked against the latest pulled main branch
- if `git fetch` or `git pull --ff-only origin main` fails, do not issue a final "failed", "not fixed", or "not closable" verdict on frontend implementation; report `verification risk` or `waiting_sync` instead
- if a Lovable report says code is complete but pulled `main` still shows only handoff commits and no `src` implementation commit, treat that as `waiting_sync`

## 8. Feedback contract

Every execution must write back using this shape:

1. task id
2. mode
3. status
   - `fixed`
   - `blocked`
   - `paused`
   - `waiting_sync`
   - `waiting_verify`
   - `done_without_change`
4. changed files or synced files
5. verification result
6. commit SHA or `no git action`
7. pending issues
8. next handoff target

For `VERIFY`, always include:

- pulled frontend commit SHA
- `origin/main` commit SHA
- working tree status summary
- whether local build passed
- whether the task is closable

For `SYNC`, always include:

- synced files
- pushed frontend commit SHA
- whether the target files are visible in remote `main`

## 9. Loop-prevention rule

If any of the following happens, stop and report it as a logic-loop risk:

1. the same task is dispatched again without any file-state change
2. `CURRENT.md` and queue board disagree
3. chat says active but file says waiting
4. you are asked to verify a task that PM has already reopened
5. you are asked to sync a task package that is already present in remote `main`
6. local `HEAD` is behind `origin/main` but someone still asks for a final rejection based on local stale code

## 10. Definition of done

A task is not done just because code was changed.

The closure path is:

1. task file is correct
2. implementation or sync commit exists
3. local verification passes if required
4. PM updates queue state and closes it

Until PM closes it, treat it as still live.
