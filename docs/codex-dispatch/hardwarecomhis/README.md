# hardwarecomhis

Purpose: PM-owned handoff directory for hardware and board-level work.
Audience: PM and 硬件工程师

## Official live entry

- `docs/codex-dispatch/hardwarecomhis/CURRENT.md`
- `docs/codex-dispatch/hardwarecomhis/RESULT.md`

When PM or the user says only "execute", 硬件工程师 must read `CURRENT.md` first and write back to `RESULT.md`.

## Naming

- task files: `HW-xxxx-*.md`
- context files: `context/HW-xxxx-context.md`
- fixtures: `fixtures/HW-xxxx/*`

## Reading order

1. read `docs/codex-dispatch/hardwarecomhis/CURRENT.md`
2. read the linked task file
3. read the matching context file
4. read the matching fixtures
5. return only the requested hardware deliverables

## Expected return from hardware

- revision number
- BOM or drawing package reference
- validation result
- electrical / connector / power constraints
- pending issues

## Rule

Hardware tasks must define interface constraints explicitly.
If anything about connectors, power, radio module, enclosure, or field environment is unclear, return a pending issue instead of guessing.
If `CURRENT.md` is marked `paused`, do not execute even if a historical task file exists.
