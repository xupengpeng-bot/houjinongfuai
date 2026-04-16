# Project Docs Map

Status: active
Audience: PM, Codex, Lovable, embedded, hardware, QA
Purpose: separate business requirements from development-system execution docs and define the reading order for this repository.

## Business-doc reading order

1. `AGENTS.md`
2. `docs/requirements/README.md`
3. `docs/系统说明/README.md`
4. `docs/p1/README.md`
5. `docs/protocol/device-protocol-v1.md`
6. `docs/protocol/device-event-model-v1.md`
7. `docs/protocol/hardware-interface-planning-v1.md`
8. `docs/protocol/controller-hardware-sku-planning-v1.md`
9. `docs/protocol/controller-board-reuse-and-embedded-interface-v1.md`
10. `docs/protocol/embedded-controller/embedded-controller-profile-config-v1.md`
11. `docs/protocol/embedded-controller/embedded-controller-capability-composition-v1.md`
12. `docs/protocol/embedded-controller/embedded-controller-dictionaries-v1.md`
13. `docs/protocol/embedded-controller/embedded-controller-message-pack-v1.md`
14. `docs/protocol/embedded-controller/embedded-controller-schema-pack-v1.md`
15. `docs/protocol/embedded-controller/embedded-controller-platform-alignment-v1.md`
16. `docs/protocol/embedded-controller/embedded-controller-interface-catalog-v1.md`
17. `docs/protocol/embedded-controller/embedded-controller-firmware-dev-spec-v1.md`
18. `docs/protocol/embedded-controller/embedded-controller-reliability-architecture-v1.md`
19. `docs/protocol/embedded-controller/embedded-controller-ota-spec-v1.md`
20. `docs/protocol/embedded-controller/embedded-controller-storage-cache-spec-v1.md`
21. `docs/protocol/embedded-controller/embedded-controller-runtime-schema-migration-draft-v1.md`
22. `docs/uat/README.md`
23. `docs/lovable/README.md`

## Development-System Entry

AI task dispatch, onboarding, execution modes, and workflow governance for the current workspace are maintained here:

- `D:\Develop\houji\houjinongfuAI-Cursor\hartware\projects\houjinongfuai`

Shared reusable development-system rules for the current workspace are maintained here:

- `D:\Develop\houji\houjinongfuAI-Cursor\hartware\shared`

Read the project development-system folder when you need:

- `docs/codex/README.md`
- `docs/codex/CURRENT.md`
- `docs/codex/RESULT.md`
- `docs/governance/README.md`
- work modes
- task types
- dispatch protocol
- delivery workflow

## Active folders

- `docs/requirements`
  - human-facing requirement entry and reading order.
- `docs/系统说明`
  - current formal business requirement truth and product rules.
- `docs/p1`
  - Phase 1 scope, model, state, API, schema, and module baseline.
- `docs/protocol`
  - device protocol, event model, settlement rules, and embedded-controller specification set.
- `docs/uat`
  - current domain freeze, compatibility mapping, contract checklist, UAT plan, and active Codex/Lovable sync.
- `docs/lovable`
  - active frontend integration notes only.
- `docs/codex-dispatch/`
  - embedded / hardware / frontend coordination folders (`embeddedcomhis`, `hardwarecomhis`, `lovablecomhis`) moved from the repository root. See `docs/codex-dispatch/README.md`.
- `docs/附属项目-waterflow-control.md`
  - archived notes for the former standalone `waterflow-control` demo; active UI lives in `lovable-working/src/features/waterflow/`.
- `docs/devtools`
  - bridge only; active shared development-system tooling notes now live in `D:\Develop\houji\houjinongfuAI-Cursor\hartware\shared`.
- `docs/governance`
  - bridge only; active project-governance docs now also exist in `D:\Develop\houji\houjinongfuAI-Cursor\hartware\projects\houjinongfuai\docs\governance`.
- `docs/codex`
  - bridge only; active AI task-dispatch docs now also exist in `D:\Develop\houji\houjinongfuAI-Cursor\hartware\projects\houjinongfuai\docs\codex`.

## Historical folders

- `docs/archive`
  - historical task sheets, prototype maps, exploratory CRUD references, and superseded contract notes.

## Document rules

- A document in `docs/archive` is not a live source of truth.
- Prototype docs must not be used as runtime API truth.
- If an active doc conflicts with an archived doc, the active doc wins.
- If two active business docs conflict, follow `AGENTS.md`, then `docs/系统说明`, then `docs/p1`, then `docs/uat/frontend-backend-contract-checklist-v1.md`, then `docs/uat/lovable-codex-sync.md`.

## Requirement vs task rule

- Business requirements are for humans.
  - They describe overall goals, scope, functional points, object relationships, and acceptance expectations.
- AI task instructions are for execution.
  - They live in the project development-system folder.
- The correct order is:
  1. confirm or update business requirements in this repository
  2. freeze the requirement scope
  3. decompose the confirmed scope into typed AI tasks in the project development-system folder
  4. execute and verify

Do not use AI task sheets as a replacement for business requirement documentation.

## Shared Environment Reset Rule

For shared or local verification environments, the safe reset or reseed order is:

1. `npm run db:migrate:reset`
2. `npm run db:seed:reference`
3. if business baseline is explicitly needed:
   - `npm run db:seed:baseline`
4. if demo data is explicitly needed:
   - `npm run db:seed:demo`
5. if test or UAT data is explicitly needed:
   - `npm run db:seed:test`
6. after verification:
   - `npm run testdata:cleanup`

Rule:

- `region_reference` is foundational reference data and must survive cleanup.
- business `region`, `project`, `asset`, `device`, runtime, order, and UAT rows must not be written by default startup.
- `db:seed:baseline`, `db:seed:demo`, and `db:seed:test` now all rebuild the nationwide `region_reference` library first instead of falling back to the old sample slice.
