# Project Docs Map

Status: active
Audience: PM, Codex, Lovable, embedded, hardware, QA
Purpose: separate business requirements from development-system execution docs and define the reading order for this repository.

## Business-doc reading order

1. `AGENTS.md`
2. `docs/requirements/README.md`
3. `docs/绯荤粺璇存槑/README.md`
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

## Development-system entry

AI task dispatch, onboarding, execution modes, and workflow governance have been moved out of this business repository.

Use this external workspace:

- `D:\20251211\zhinengti\development-system\projects\houjinongfuai`

Read there when you need:

- `CURRENT.md`
- `RESULT.md`
- work modes
- task types
- dispatch protocol
- delivery workflow

## Active folders

- `docs/requirements`
  - human-facing requirement entry and reading order.
- `docs/绯荤粺璇存槑`
  - current formal business requirement truth and product rules.

- `docs/p1`
  - Phase 1 scope, model, state, API, schema, and module baseline.
- `docs/protocol`
  - Device protocol, event model, and settlement rules.
- `docs/uat`
  - Current domain freeze, compatibility mapping, contract checklist, UAT plan, and active Codex/Lovable sync.
- `docs/lovable`
  - Active frontend integration notes only.
- `docs/codex-dispatch/`
  - 宓屽叆寮?/ 纭欢 / 鍓嶇鍗忎綔娲惧崟鐩綍锛坄embeddedcomhis`銆乣hardwarecomhis`銆乣lovablecomhis`锛夛紝宸蹭粠浠撳簱鏍硅縼鍏ワ紝瑙?`docs/codex-dispatch/README.md`銆?
- `docs/闄勫睘椤圭洰-waterflow-control.md`
  - 鐏屾簤璋冨害/绠＄綉閰嶇疆鍓嶇 Demo锛坄waterflow-control`锛夌殑 **Git 鍦板潃銆佹帹鑽愬厠闅嗚矾寰勩€佺鍙ｄ笌渚濊禆鎽樿**锛涗笌涓诲伐绋嬪苟鍒楁椂寤鸿鏀惧湪 `houjinongfuAI-Cursor\waterflow-control`銆?
- `docs/devtools`
  - bridge only; shared development-system rules now live in `D:\20251211\zhinengti\development-system\shared`.
- `docs/governance`
  - bridge only; the active development-governance docs now live in the external development-system workspace.
- `docs/codex`
  - bridge only; the active AI task-dispatch docs now live in the external development-system workspace.

## Historical folders

- `docs/archive`
  - Historical task sheets, prototype maps, exploratory CRUD references, and superseded contract notes.

## Document rules

- A document in `docs/archive` is not a live source of truth.
- Prototype docs must not be used as runtime API truth.
- If an active doc conflicts with an archived doc, the active doc wins.
- If two active business docs conflict, follow `AGENTS.md`, then `docs/绯荤粺璇存槑`, then `docs/p1`, then `docs/uat/frontend-backend-contract-checklist-v1.md`, then `docs/uat/lovable-codex-sync.md`.

## Requirement vs task rule

- Business requirements are for humans.
  - They describe overall goals, scope, functional points, object relationships, and acceptance expectations.
- AI task instructions are for execution.
  - They live in the external development-system workspace.
- The correct order is:
  1. confirm or update business requirements in this repository
  2. freeze the requirement scope
  3. decompose the confirmed scope into typed AI tasks in the development-system workspace
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


