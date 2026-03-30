# Embedded Dispatch 2026-03-24

Status: paused
Audience: 嵌入式工程师
Purpose: official PM dispatch for the first embedded baseline wave.

Paused note:

- do not execute now
- reopen only when PM starts the device integration wave

## Read first

1. `docs/codex-dispatch/embeddedcomhis/README.md`
2. `docs/governance/delivery-workflow.md`
3. `docs/codex-dispatch/embeddedcomhis/EMB-0001-tcp-json-v1固件接入基线.md`
4. `docs/codex-dispatch/embeddedcomhis/context/EMB-0001-context.md`
5. `docs/codex-dispatch/embeddedcomhis/fixtures/EMB-0001/*`

## Execute now

- `EMB-0001`

## Scope

This wave is a firmware / protocol baseline wave, not a full production firmware rollout.

Deliver at least:

- minimum message support list
- sample logs
- supported / unsupported items
- explicit blockers

## Git rules

- If there is a dedicated firmware repo, commit there and return the commit SHA.
- If there is no firmware repo available in the current environment, place the result files under `docs/codex-dispatch/embeddedcomhis/` and commit those documentation artifacts in this repo.
- Do not fabricate a firmware SHA if no firmware repo was actually used.
- Do not commit `.env`, local tool caches, or unrelated generated files.

## Required result format

1. task id
2. firmware repo or workspace used
3. commit SHA or explicit "no firmware repo in current workspace"
4. sample log path
5. supported items
6. unsupported items
7. pending issue
