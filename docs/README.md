# Project Docs Map

Status: active
Audience: PM, Codex, Lovable, embedded, hardware, QA
Purpose: define which docs are canonical, which are historical, and the reading order for this repository.

## Active reading order

1. `AGENTS.md`
2. `docs/p1/README.md`
3. `docs/protocol/device-protocol-v1.md`
4. `docs/protocol/device-event-model-v1.md`
5. `docs/uat/frontend-backend-contract-checklist-v1.md`
6. `docs/uat/lovable-codex-sync.md`
7. `docs/governance/file-only-command-protocol.md`
8. `docs/governance/delivery-workflow.md`

## Active folders

- `docs/p1`
  - Phase 1 scope, model, state, API, schema, and module baseline.
- `docs/protocol`
  - Device protocol, event model, and settlement rules.
- `docs/uat`
  - Current domain freeze, compatibility mapping, contract checklist, UAT plan, and active Codex/Lovable sync.
- `docs/lovable`
  - Active frontend integration notes only.
- `docs/governance`
  - PM-facing document system, file-only execution protocol, communication review, and delivery workflow.

## Historical folders

- `docs/archive`
  - Historical task sheets, prototype maps, exploratory CRUD references, and superseded contract notes.

## Document rules

- A document in `docs/archive` is not a live source of truth.
- Prototype docs must not be used as runtime API truth.
- If an active doc conflicts with an archived doc, the active doc wins.
- If two active docs conflict, follow `AGENTS.md`, then `docs/p1`, then `docs/uat/frontend-backend-contract-checklist-v1.md`, then `docs/uat/lovable-codex-sync.md`.

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
