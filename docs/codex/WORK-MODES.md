# Codex Work Modes

Status: active
Audience: PM, software engineer
Purpose: reduce dispatch ambiguity by separating software-engineer work into fixed modes.

## Path baseline

- Treat the currently opened repository root as the backend workspace.
- Treat the real frontend repository as the sibling folder `../lovable` unless a task file explicitly freezes another path.
- Prefer repository-relative paths in task files, protocols, and handoff notes.

## Why this exists

The previous workflow mixed three different responsibilities into one stream:

1. syncing PM task packages into frontend Git `main`
2. pulling frontend cloud results back to local
3. verifying the pulled result

That made execution reports noisy and made it too easy to dispatch the right person in the wrong mode.

## Mode 1: `SYNC`

Meaning:

- software engineer works only as the local Git synchronization operator
- no frontend business behavior should change in this mode

Typical work:

- sync PM-created frontend task packages into frontend GitHub `main`
- sync updated `CURRENT.md`, `WAVE.md`, `README.md`, `context`, and `fixtures`

Must do:

- keep the write set limited to task-package and protocol files
- return the pushed frontend commit SHA

Must not do:

- mix frontend business-code edits into the sync commit
- claim frontend task completion

## Mode 2: `VERIFY`

Meaning:

- software engineer works only as the local pull + acceptance verifier

Typical work:

- run `git pull --ff-only origin main` in `../lovable`
- run `git rev-parse HEAD`
- run `git rev-parse origin/main`
- run `git status --short`
- run local build
- compare pulled code against the active frontend task completion checklist

Must do:

- report the pulled frontend `HEAD` commit SHA
- report the checked `origin/main` commit SHA
- report whether the working tree was clean or dirty
- report whether the task is locally closable

Must not do:

- silently patch missing frontend behavior locally
- close the task without local acceptance evidence
- use stale local code as the final basis for rejecting a task

Hard verification gate:

- Before reporting that a frontend task is still broken, incomplete, or not closable, the verifier must first confirm `HEAD`, `origin/main`, and `git status --short`.
- If local `HEAD` is behind `origin/main`, the verifier must not reject the task based on old local code.
- If the working tree is dirty, the verifier must explicitly mark the conclusion as a verification risk unless the task has been rechecked on a clean, up-to-date snapshot.

## Dispatch rule

When PM activates a software-engineer task, the task file and `CURRENT.md` should always make the mode explicit:

- `BACKEND`
- `SYNC`
- `VERIFY`

If the mode is not explicit, PM should fix the task file before dispatch.
