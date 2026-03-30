# embeddedcomhis

Purpose: PM-owned handoff directory for embedded and firmware work.
Audience: PM and 嵌入式工程师

## Official live entry

- `docs/codex-dispatch/embeddedcomhis/CURRENT.md`
- `docs/codex-dispatch/embeddedcomhis/RESULT.md`

When PM or the user says only "execute", 嵌入式工程师 must read `CURRENT.md` first and write back to `RESULT.md`.

## Naming

- task files: `EMB-xxxx-*.md`
- context files: `context/EMB-xxxx-context.md`
- fixtures: `fixtures/EMB-xxxx/*`

## Reading order

1. read `docs/codex-dispatch/embeddedcomhis/CURRENT.md`
2. read the linked task file
3. read the matching context file
4. read the matching fixtures
5. implement only within the described scope

## Expected return from embedded

- commit SHA or firmware package version
- target board / module / device identifier
- protocol log or test result
- pending issues

## Rule

If backend protocol rules are needed, PM must mirror them into the task package or context file.
Embedded work must not depend on guessing backend behavior from scattered docs.
If `CURRENT.md` is marked `paused`, do not execute even if a historical task file exists.
