# Hardware Dispatch 2026-03-24

Status: paused
Audience: 硬件工程师
Purpose: official PM dispatch for the first hardware baseline wave.

Paused note:

- do not execute now
- reopen only when PM starts the device integration wave

## Read first

1. `docs/codex-dispatch/hardwarecomhis/README.md`
2. `docs/governance/delivery-workflow.md`
3. `docs/codex-dispatch/hardwarecomhis/HW-0001-通信与供电接口基线.md`
4. `docs/codex-dispatch/hardwarecomhis/context/HW-0001-context.md`
5. `docs/codex-dispatch/hardwarecomhis/fixtures/HW-0001/*`

## Execute now

- `HW-0001`

## Scope

This wave is an interface and constraint baseline wave.
It is not a complete hardware redesign wave.

Deliver at least:

- communication module baseline
- IMEI bearing strategy
- power and connector boundary
- actuator output boundary
- risks and open questions

## Git rules

- If there is a dedicated hardware repo or package location, commit there and return the revision or commit SHA.
- If there is no dedicated hardware repo in the current environment, place the result files under `docs/codex-dispatch/hardwarecomhis/` and commit those artifacts in this repo.
- Do not fabricate a revision id.
- Do not commit unrelated binaries, local caches, or temporary export files unless they are the actual requested deliverables.

## Required result format

1. task id
2. hardware repo or workspace used
3. revision / commit SHA or explicit "no hardware repo in current workspace"
4. output artifact list
5. risk list
6. pending issue
