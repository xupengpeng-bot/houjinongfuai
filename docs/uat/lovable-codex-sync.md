# Lovable <-> Codex Sync

Status: active  
Purpose: fixed handoff file for frontend / backend integration questions in Phase 1  
Owner:

- Codex: backend contract gatekeeper
- Lovable: frontend implementation and display adaptation

## Current baseline conclusion

- New top-level project rule from 2026-03-23 onward:
  - this is treated as a clean-slate project line, not a legacy-compatible line
  - do not add compatibility layers
  - do not keep dual semantics
  - do not preserve historical fallback behavior just to avoid reseeding
  - if needed, prefer reset / reseed over carrying hidden maintenance cost
- Region / Project / Asset line is now re-frozen under the clean-slate rule:
  - Region page keeps using `region-library/*` to materialize standard administrative divisions into business `region`
  - Project hangs only from business `region.id` (UUID)
  - Project must not consume or submit `region_reference.code`
  - Asset ownership stays on `project_id`
  - Asset manual physical location keeps a single truth on `region_reference.code`
  - do not keep UUID/code dual-write or dual-read behavior for the same business field

- Backend 2A is closed: runtime/order mainline is stable.
- Backend 2B is closed: seed scenario registry, seed integrity checks, fallback source assertions, and UAT smoke are fixed.
- Backend 2C is closed: page / endpoint / field level checklist and view-contract smoke are fixed.
- The first frontend CRUD attempt for `wells`, `devices`, and `pump-valve-relations` is exploratory only.
- The domain has now been re-frozen as:
  - Region -> Project -> Asset tree -> Device -> Relations -> Location
- LVB-4003 is closed: the Asset form now has a dedicated `manual_region_id` selector and the manual-location block is considered closed for the first Asset wave.
- Asset / asset_tree first wave is currently considered closed enough to move forward.
- LVB-4004 is functionally complete: the unified device ledger first wave now has `asset_id`, `device_type`, and `manual_region_id` selectors, manual-location grouping, and a read-only communication-identity boundary.
- The unified device-ledger first wave is currently considered closed enough to move forward.
- LVB-4005 is functionally complete: the device relations / control topology first wave now provides a generalized relation configuration entry instead of continuing `pump-valve-relations` expansion.
- The device-relations / control-topology first wave is currently considered closed enough to move forward.
- LVB-4006 is functionally implemented but not yet accepted as closed.
- The current review result for LVB-4006 is an A-class follow-up:
  - the frontend structure exists
  - build passes
  - but mock CRUD behavior and error-path behavior are not fully closed yet
- BE-REGION-CASCADE-CONTRACT-001 is fixed:
  - `GET /api/v1/regions/cascade-options` is now available
  - the backend seed now contains a stable five-level administrative chain:
    - province
    - city
    - county
    - town
    - village
- LVB-4008 remains open after real-mode review:
  - the backend B-class contract gap for region cascade is closed
  - but the frontend administrative selection still has not switched to `region-library/search|children|path`
  - Region create currently uses `/regions/cascade-options` plus `/regions/options`
  - Region `level` is now auto-derived and readonly, but `code` is still user-editable
  - the Asset manual-location block still uses latitude / longitude fallback inputs instead of a real map point picker
- The region input rule is now tightened further:
  - province / city / county / town / village must be driven by a backend region reference library
  - frontend must not keep free-form administrative input
- BE-REGION-LIBRARY-CONTRACT-001 is now closed:
  - `GET /api/v1/region-library/search`
  - `GET /api/v1/region-library/children`
  - `GET /api/v1/region-library/path`
  are available in real mode
  - the backend reference table is now the long-term administrative region source
- LVB-4009 remains open after final browser review:
  - frontend Region / Project / Asset flows still consume `/regions/options` and `/regions/cascade-options`
  - frontend has not switched to `/region-library/search|children|path`
  - Region create still keeps `code` as a user-editable field instead of a library-driven readonly result
- LVB-4008 remains open after final browser review:
  - Asset manual location still uses a fallback `MapPointPicker`
  - there is no real map-based point-selection capability yet
- Final real-mode acceptance after nationwide region_reference import:
  - backend `region-library/search|children|path` is closed and backed by nationwide five-level reference data
  - frontend Region / Project / Asset flows still do not consume `region-library/*`
  - the current frontend options still come from the sample business-region chain instead of nationwide library data
  - Region create now auto-derives readonly `level`, but still exposes editable `code`
  - Region create still requires manual `name` entry for the new node instead of selecting an administrative-division record from the library
  - Project region selection and Asset `manual_region_id` still use `/regions/options`
  - `MapPointPicker` still shows the fallback "地图组件待接入" state
- LVB-4010 is the focused A-class closure handoff for the remaining frontend-only issues:
  - switch Region / Project / Asset administrative selection to `region-library/search|children|path`
  - remove free-form region code / parent / level entry from the Region create flow
  - keep LVB-4008 / LVB-4009 open until a real map point picker replaces the fallback picker
- Final real-mode acceptance after LVB-4010 implementation:
  - frontend Region / Project / Asset selectors now really consume `region-library/children` and `region-library/path`
  - frontend no longer uses `/regions/options` or `/regions/cascade-options` as the administrative truth source for those selectors
  - Region create now uses library selection with readonly `level`, readonly `code`, and readonly library-derived `name`
  - Asset map point selection is now a real Leaflet picker:
    - the map renders in real mode
    - click places a marker
    - dragging the marker updates coordinates
    - confirm backfills `manual_latitude` / `manual_longitude`
  - however Project and Asset real submissions are not fully closed:
    - Project create sends a region-library code such as `110101`, but backend `/projects` still parses `region_id` as UUID and returns `500 invalid input syntax for type uuid`
    - Asset create sends a region-library code such as `110101001001`, but backend `/assets` still parses `manual_region_id` as UUID and returns `500 invalid input syntax for type uuid`
    - existing seeded Project / Asset edit dialogs still preload old business-region UUIDs into `region-library/path`, causing `404 Region reference not found`
- The next step is not a generic new business object.
- The next step is:
  - a B-class backend contract proposal for region reference library support
  - and a focused frontend closure task that consumes region-library endpoints
- LVB-4008 is no longer enough as the final closure path for Region / Project / Asset location entry.
- The follow-up handoff should move to LVB-4009.
- Until the next explicit frontend task is issued, do not expand CRUD based on the old exploratory assumptions.
- BE-PRJ-AST-REGION-LIB-COMPAT-001 is now fixed:
  - backend keeps `project.region_id` and `asset.manual_region_id` as UUID foreign keys internally
  - frontend-facing `region_id` / `manual_region_id` now accept region-library codes and are mapped server-side to business `region.id`
  - Project create / update still accept region-library codes for compatibility, but Project list / detail / edit prefill have now been pulled back to business Region UUIDs
  - Asset detail / list now expose `manual_region_id` as administrative region code instead of seeded business-region UUIDs
  - selecting a county / town / village code can now auto-materialize missing ancestor business regions from `region_reference`
  - the remaining Region / Project / Asset real-mode blockers are no longer backend contract issues
- This compatibility-based state is no longer the target end state.
- Under the new clean-slate rule:
  - Project-side region-library compatibility must be removed
  - Project create / update / list / detail / prefill must all use business Region UUID only
  - Asset should keep one clean location truth instead of mixing business Region UUID with reference-library code semantics
- Clean-slate execution has now started on the Project line:
  - backend `Project` no longer accepts region-library code input
  - backend `Project` no longer serializes `region_id` as administrative code
  - `Project.region_id` is now business Region UUID only
  - the current real-mode Project page therefore requires `LVB-4011` before browser flows can pass again
- Final frontend code acceptance for `LVB-4011` is now complete:
  - `ProjectFormDialog` consumes business Region options through `useRegionOptions()`
  - Project no longer directly depends on `region-library/*`
  - edit / update preserves and submits `region_id`
  - mock create / update / delete now mutate `mockProjectList`
  - Project mock region options come from one business-region source only
- Additional frozen Project rule after `LVB-4011` closure:
  - Project create must choose only from already-created business Regions in the system
  - Project must not show or consume the full nationwide administrative library in its own region selector
  - the Project region selector remains strictly backed by `/api/v1/regions/options`

## Canonical references

- Domain layering:
  - [domain-region-project-asset-device-v2.md](D:\20251211\zhinengti\houjinongfuai\docs\uat\domain-region-project-asset-device-v2.md)
- Relation model:
  - [relation-model-v2.md](D:\20251211\zhinengti\houjinongfuai\docs\uat\relation-model-v2.md)
- Location model:
  - [location-model-v1.md](D:\20251211\zhinengti\houjinongfuai\docs\uat\location-model-v1.md)
- Current API / page compatibility mapping:
  - [domain-compat-mapping-v1.md](D:\20251211\zhinengti\houjinongfuai\docs\uat\domain-compat-mapping-v1.md)
- Frontend / backend contract checklist:
  - [frontend-backend-contract-checklist-v1.md](D:\20251211\zhinengti\houjinongfuai\docs\uat\frontend-backend-contract-checklist-v1.md)
- PM workflow:
  - [delivery-workflow.md](D:\20251211\zhinengti\houjinongfuai\docs\governance\delivery-workflow.md)
- Document system:
  - [document-system.md](D:\20251211\zhinengti\houjinongfuai\docs\governance\document-system.md)
- Historical exploratory CRUD docs:
  - moved to [README.md](D:\20251211\zhinengti\houjinongfuai\docs\archive\uat\README.md)

## Triage rule

Every newly reported frontend integration issue should be classified into one of these three buckets first.

### A. Frontend display / consumption issue, no backend patch needed

Typical signals:

- backend field already exists
- backend contract smoke is green
- page still hardcodes text, status, or local mapping
- page does not consume an already exposed backend field
- page assumes the old exploratory CRUD meaning instead of the frozen domain meaning

Action:

- no backend code change
- if frontend work is needed later, create `lovablecomhis/LVB-xxxx-*.md` plus fixtures in the frontend repo

### B. Minimal backend contract gap, patch allowed

Typical signals:

- page needs a field that clearly exists in backend query results but is not exposed
- response needs a safe alias / default / null protection for current integration
- list shape is unstable for existing page usage
- tiny query compatibility issue blocks current real integration

Action:

- patch backend minimally
- keep canonical contract explicit
- do not change business rules or runtime semantics

### C. Out of current phase / defer to next stage

Typical signals:

- requires generic project / asset / relation APIs that do not exist yet
- requires new runtime semantics
- requires device event driven behavior
- requires payment or card integration changes
- requires richer lifecycle workflows not in the current phase

Action:

- do not patch now
- record in the next-stage bucket

## CRUD phase rule

Before Lovable starts building or extending a CRUD page or form:

1. check the domain layering document
2. check the relation model
3. check the location model
4. check the compatibility mapping
5. check the frontend/backend contract checklist
6. check the current live LVB task package and context
7. check active smoke or verification evidence when available

Execution rule:

- if an object is not explicitly approved in the current phase, do not assume a create/edit form should be built
- if the docs are incomplete or an endpoint looks suspicious, add the issue to `Pending issues to classify` first
- only after the issue is recorded should Codex classify it as A / B / C

Special rule:

- runtime pages, workflow pages, aggregates, and action endpoints must not be turned into generic CRUD
- `wells`, `devices`, and `pump-valve-relations` exploratory forms are not the final domain contract
- do not continue expanding those forms until the next frontend task is issued against the frozen model

## Pending issues to classify

| ID | Source | Page / Module | Question | Status | Bucket | Notes |
|---|---|---|---|---|---|---|
| 2026-03-22-A01 | Lovable LVB-4002 completion | Asset form | `manual_region_id` exists in fixtures and context as part of manual location, but the Asset form did not land the Region selector yet | closed | A | Reuse existing Region option capability; no backend patch needed; frontend should close this as a focused form-consumption task |
| 2026-03-23-A02 | Lovable LVB-4006 completion review | Device type page / mock handlers | Device type page structure exists, but mock create/update/delete do not persist into the mock list, delete-success does not remove rows, and explicit mock error-shell / blocked / validation paths are not fully closable through page behavior | open | A | Frontend closure only; no backend patch required; fix in a dedicated A-class follow-up task |
| 2026-03-23-A03 | LVB-4008 real-mode closure review | Region form | Backend cascade contract is ready, but the page still does not consume `region-library/*`; Region create still exposes editable `code` instead of a library-driven readonly result | closed | A | Closed by LVB-4010: Region selector now consumes `region-library/children|path`, and `code / level / name` are library-driven readonly fields |
| 2026-03-23-A04 | LVB-4008 real-mode closure review | Asset manual location | `manual_region_id` works in real mode, but map point selection is still fallback-only: plain latitude / longitude inputs without a real map picker | closed | A | Closed by LVB-4010: Asset uses a real Leaflet map picker, supports click + drag, and backfills `manual_latitude / manual_longitude` |
| 2026-03-23-B02 | Region / Project / Asset next-step freeze | Region / Project / Asset forms | Administrative levels must no longer be free-entered; frontend should consume a backend-owned region reference library instead of hand-built cascades | closed | B | Backend contract is now delivered through `region_reference` plus `region-library/search|children|path` |
| 2026-03-23-A05 | Final acceptance review for LVB-4008 / LVB-4009 | Region / Project / Asset region selectors | Backend `region-library/*` contract is ready, but frontend still uses `/regions/options` and `/regions/cascade-options` for administrative selection; current options still come from the sample business-region chain; Region create still keeps `code` editable and requires manual `name`; Project / Asset selectors still use `/regions/options` | closed | A | Closed by LVB-4010: Region / Project / Asset selectors now hit `region-library/children|path` in real mode |
| 2026-03-23-A06 | LVB-4010 generation | Region / Project / Asset / MapPointPicker | Consolidate the remaining frontend-only closure items into a single follow-up: real `region-library/*` wiring, readonly derived region fields, and replacing the fallback map picker with a real map point picker | closed | A | Frontend A-class closure task delivered; remaining blockers are no longer A-class |
| 2026-03-23-A07 | Product rule change after LVB-4009 closure | Project form | Project must no longer select a region directly from `region-library`; it must select only from already-added business Regions in the system | closed | A | Closed by the final `LVB-4011` frontend cleanup: Project now consumes only `/regions/options`, shows only already-created business Region options, persists `region_id` during update, and keeps mock region options on one business-region source. |
| 2026-03-23-B03 | Final acceptance for LVB-4010 | Project create / edit | Frontend now submits region-library codes through `region_id`, but backend `/projects` still parses `region_id` as UUID; create returns `500 invalid input syntax for type uuid`, and edit prefill still calls `region-library/path` with the old business-region UUID from seeded data | closed | B | Closed by BE-PRJ-AST-REGION-LIB-COMPAT-001: `/projects` now accepts region-library codes and serializes seeded region relations back as codes |
| 2026-03-23-B04 | Final acceptance for LVB-4010 | Asset create / edit | Frontend now submits region-library codes through `manual_region_id`, but backend `/assets` still parses `manual_region_id` as UUID; create returns `500 invalid input syntax for type uuid`, and edit prefill still calls `region-library/path` with the old business-region UUID from seeded data | closed | B | Closed by BE-PRJ-AST-REGION-LIB-COMPAT-001: `/assets` now accepts region-library codes and serializes seeded manual-region relations back as codes |
| 2026-03-23-B05 | Product rule change after LVB-4009 closure | Project detail / edit prefill contract | New rule requires Project to use business Region UUIDs end to end, while remaining compatible with the current pre-LVB-4011 frontend during real-mode edit prefill | closed | B | Closed by Project contract rollback: list / detail / options now return business Region UUIDs again, and `region-library/path` temporarily accepts business Region UUIDs so the current real-mode picker can still prefill correctly |
| 2026-03-23-B06 | New Project create-form product rule | Project create contract | New rule requires Project create to stop accepting frontend-entered `project_code`, reuse `owner` as the single "project owner" semantic, and add one `contact_phone` field while keeping region selection on business Region UUID only | closed | B | Closed by the clean-slate Project backend patch: `contact_phone` added, create no longer accepts frontend `project_code`, and backend now generates `project_code` authoritatively |
| 2026-03-23-R01 | Clean-slate rule reset | Region / Project / Asset model | New top-level rule: stop optimizing for compatibility and hidden transition layers; prefer one clean truth per field, reset / reseed if needed, and remove dual semantics | fixed | Rule | Highest-priority project rule from now on |

## Codex decisions log

| Date | Issue | Decision | Result |
|---|---|---|---|
| 2026-03-22 | Seed scenario drift in runtime/order tests | Consolidated scenario registry and integrity checks | fixed |
| 2026-03-22 | Fallback allow source chain not explicit enough | Added explicit `resolved_from` assertions in tests | fixed |
| 2026-03-22 | UAT page reads not formally stabilized | Added UAT smoke and view-contract smoke | fixed |
| 2026-03-22 | Basic master data CRUD and field scope unclear to frontend | Added CRUD matrix and field dictionary | fixed |
| 2026-03-22 | Phase 3A form capability still unclear to frontend | Added form contracts and execution rules | fixed |
| 2026-03-22 | Old CRUD understanding would cause rework | Re-froze the domain as Region -> Project -> Asset -> Device -> Relations -> Location | fixed |
| 2026-03-22 | Asset `manual_region_id` selector missing in LVB-4002 first wave | Classified as A; mirror back as a focused Asset manual-location frontend follow-up; no backend patch required | fixed by task split |
| 2026-03-22 | LVB-4003 Asset manual location closure completed | Marked Asset / asset_tree first wave as closed enough; move next task to unified device ledger first wave | fixed |
| 2026-03-22 | LVB-4004 unified device ledger first wave completed | Marked unified device ledger first wave as closed enough; move next task to device relations / control topology first wave | fixed; execution evidence may be supplemented from version history when needed |
| 2026-03-22 | LVB-4005 device relations / control topology first wave completed | Marked device relations / control topology first wave as closed enough; move next task to device-type master-data first wave | fixed; execution evidence may be supplemented from version history when needed |
| 2026-03-23 | LVB-4006 completion review | Classified as A; frontend structure is present but mock CRUD persistence and closure behavior are incomplete; issue should be sent back as a focused A-class follow-up | open |
| 2026-03-23 | BE-REGION-CASCADE-CONTRACT-001 | Added `GET /api/v1/regions/cascade-options`, normalized `GET /api/v1/regions/options`, and seeded a stable five-level administrative chain for real-mode region cascade support | fixed |
| 2026-03-23 | LVB-4008 final closure review | Backend contract is now ready, but the frontend still needs to consume the cascade endpoint and replace map fallback inputs with a real map point picker; keep LVB-4008 open | open |
| 2026-03-23 | Region library driven input freeze | Tightened the rule again: province / city / county / town / village must come from a backend-owned reference library; generate a backend contract note plus LVB-4009 frontend closure task | open |
| 2026-03-23 | BE-REGION-LIBRARY-CONTRACT-001 final acceptance review | Backend region-library contract is delivered and works in real mode; mark the backend task closed | fixed |
| 2026-03-23 | region_reference nationwide import baseline | Added repeatable nationwide import for `region_reference`; `region-library/search|children|path` now returns real reference data across province / city / county / town / village | fixed |
| 2026-03-23 | LVB-4008 / LVB-4009 final acceptance review | Browser real-mode validation shows the remaining blockers are frontend-only: region-library endpoints are not yet consumed, and the map picker is still fallback-only; keep both LVBs open | open |
| 2026-03-23 | Final acceptance after nationwide region_reference import | Re-ran browser real-mode smoke on Region / Project / Asset. Backend region-library contract remains closed; frontend still uses `/regions/options` or `/regions/cascade-options`, current choices still come from the sample business-region chain instead of nationwide library data, Region create still leaves `code` editable and `name` manual, and Asset map point selection is still fallback-only | open |
| 2026-03-23 | LVB-4010 A-class closure handoff generated | Generated one focused frontend-only closure task for the remaining acceptance blockers: real `region-library/*` consumption plus a real map point picker. Do not open a next business LVB yet | open |
| 2026-03-23 | LVB-4010 final real-mode acceptance | Browser real-mode validation now confirms the frontend A-class work is actually landed: Region / Project / Asset selectors hit `region-library/children|path`, Region create no longer free-enters administrative fields, and Asset uses a real Leaflet map picker with click + drag backfill. The remaining blockers have shifted to backend contract / seed compatibility: Project still sends region-library codes into a UUID-only `region_id`, and Asset still sends region-library codes into a UUID-only `manual_region_id`; seeded edit dialogs also still preload old business-region UUIDs into `region-library/path` and get `404` | open |
| 2026-03-23 | BE-PRJ-AST-REGION-LIB-COMPAT-001 | Added backend region-library compatibility mapping for `Project.region_id` and `Asset.manual_region_id`: frontend may submit region-library codes, backend materializes missing business regions from `region_reference`, stores internal UUID foreign keys, and serializes list/detail values back as administrative codes for edit prefill. This closes the UUID/code mix failure in real mode without rolling the frontend back to UUID inputs | fixed |
| 2026-03-23 | Final browser real-mode acceptance for Project / Asset | Re-ran real-mode browser flows end to end after the backend compatibility patch. Project create/edit/update/delete now completes without page errors, Asset create/edit/update/delete now completes with real `region-library/children|path` wiring, and the Leaflet map picker is interactive with click + drag backfill into `manual_latitude / manual_longitude`. No fallback to old `regions/*` was observed during Project / Asset administrative selection. `LVB-4009` is closed. | fixed |
| 2026-03-23 | Product rule update: Project now hangs off business Region | Re-froze the rule again after `LVB-4009` closure: Region page keeps adding standard administrative divisions into the system from `region-library`, but Project must now select only from already-added business Regions. Generated `LVB-4011` as a frontend closure task and recorded the remaining backend prefill contract mismatch separately as B-class follow-up | open |
| 2026-03-23 | Project business-region UUID contract rollback | Re-ran the backend closure after the product-rule change. Project list / detail / options now expose business Region UUIDs again, while create / update still accept region-library codes temporarily for compatibility. `region-library/path` also accepts business Region UUID inputs so the current real-mode edit dialog can prefill without waiting for `LVB-4011`. `2026-03-23-B05` is closed. | fixed |
| 2026-03-23 | Clean-slate Project contract cutover | Removed Project-side compatibility behavior instead of preserving it. Project create / update now accept business Region UUID only; Project list / detail / prefill now return business Region UUID only; `region-library/path` no longer accepts Project UUID fallback. After reset / reseed, browser real-mode confirms the backend is clean and the remaining failure is purely that the current Project page still has not switched to business-region options. | fixed |
| 2026-03-23 | Clean-slate Region / Project / Asset reset decision | Re-froze the line under a new highest-priority rule: do not preserve compatibility layers. Project must only use business Region UUIDs; Region keeps materializing standard administrative divisions from `region-library`; Asset keeps one clean physical-location truth on `region_reference.code`. Existing compatibility helpers are now considered temporary debt to remove, not baseline to preserve. | fixed |
| 2026-03-23 | LVB-4011 completion review | Real source switch is correct: Project form now consumes `/regions/options` instead of `region-library/*`, and build passes. But the closure is still incomplete on the frontend side: edit flow drops `region_id` during update, and mock create/update/delete do not persist into the project list, so mock CRUD is not a real closed loop yet. Keep `LVB-4011` open as an A-class frontend closure until those two issues are fixed. | open |
| 2026-03-23 | LVB-4011 second review after clean-slate confirmation | Re-reviewed the actual frontend code against the clean-slate Project rule. The page still directly uses `RegionLibraryPicker`, still submits `region_reference.code`, still drops `region_id` during edit/update, and mock CRUD plus mock region options are not closed under a single business-Region source. Generated a second-pass A-class closure task `LVB-4011-项目挂业务区域选择收口-二次修正` and kept `LVB-4011` open. | open |
| 2026-03-23 | LVB-4011 final code acceptance (retracted) | A later direct code re-check against the current workspace shows the earlier close conclusion was wrong. `ProjectFormDialog` still imports `RegionLibraryPicker`, still writes `sel.code` into `region_id`, and `ProjectManagement` still strips `region_id` during update. As a result, Project can still select the full administrative library instead of only already-created business Regions. `LVB-4011` is re-opened and must be finished before Project can be treated as clean-slate closed. | open |
| 2026-03-23 | LVB-4011 second-pass package refresh | Refreshed the `LVB-4011` task file, context, and key fixtures to remove ambiguity: Project region selection must show only already-created business Regions from `/regions/options`, not the full nationwide administrative library. This is a focused A-class closure, not a new business theme. | fixed |
| 2026-03-23 | LVB-4011 final code acceptance | Final code review confirms the Project page is now clean-slate on region selection: `ProjectFormDialog` consumes `useRegionOptions()`, Project no longer depends on `RegionLibraryPicker` or `region-library/*`, `region_id` is written and persisted as business Region UUID, update flow keeps `region_id`, and Project mock CRUD plus mock region options are aligned to one business-region source. `LVB-4011` is closed. `LVB-4012` remains a separate task and is not merged into this closure. | fixed |
| 2026-03-23 | Project create-form product rule freeze | Locked the new Project create-form rules under clean-slate: region must still come only from business Region options; `project_code` must be generated by the backend instead of entered by the frontend; `owner` is the single "project owner" field; `contact_phone` is added as one required field. Generated `LVB-4012` with fixtures/context for the frontend side and recorded the missing backend contract pieces as `2026-03-23-B06`. | fixed |
| 2026-03-23 | Project region-selector scope freeze | Re-stated the product rule after user confirmation: new Project creation must select only from already-created business Regions, not from the full administrative library. `LVB-4012` task/context is updated to keep the selector strictly on `/regions/options` and to treat nationwide administrative data as Region-page input only. | fixed |
| 2026-03-23 | LVB-4012 backend baseline delivered | Completed the minimal clean-slate Project backend patch for the new create-form rule: added `contact_phone`, removed frontend-supplied `project_code` from create, generated `project_code` on the backend via `project_code_seq`, kept update readonly for `project_code`, refreshed the seed baseline, and aligned the frontend task/context files to the delivered contract. `LVB-4012` can now be handed to Lovable for the frontend side. | fixed |
| 2026-03-23 | LVB-4012 final code acceptance | Final frontend code review confirms the create form no longer sends `project_code`, `contact_phone` is required with RHF-compatible validation, the Project owner label is unified as `项目负责人`, Project region selection still comes only from `/api/v1/regions/options`, and mock create auto-generates `project_code` under the same clean-slate contract. `LVB-4012` is closed. | fixed |
| 2026-03-23 | UAT test data cleanup baseline | Added repeatable backend cleanup entry `npm run testdata:cleanup` and made post-UAT data cleanup a global closeout rule. Old device types, device ledger rows, relation rows, sessions, orders, alerts, work orders, and UAT case/execution rows must be cleared after verification closes. | fixed |
| 2026-03-23 | UAT cleanup scope correction | Tightened the cleanup rule after validation: only the administrative reference library stays. `region_reference` is preserved as foundational drop-down data; business `region` and related `sys_data_scope` remain cleanup targets together with temporary project/asset rows plus device/runtime/order/UAT test data. | fixed |
| 2026-03-23 | Startup seed strategy clean-slate closure | Split database seeding into `reference / baseline / demo / test` layers, changed `db:seed` to safe reference-only behavior, and removed automatic business/demo/test seeding from `start-backend.ps1` and `start-web-test.ps1`. Starting the database or app no longer injects business/UAT dirt unless a seed profile is explicitly requested. | fixed |
| 2026-03-23 | Asset clean-slate line freeze and task split | Reviewed the real Asset code and re-froze the line under clean-slate rules: `asset_code` must move to backend-generated only; Asset business ownership stays on `project_id`; manual physical location keeps the single truth on `region_reference.code`; current code still carries old `manual_region_id` compatibility behavior; no stable `maintenance_team` object exists yet. Split the work into `LVB-4013` (asset form contract), `LVB-4014` (maintenance-team model and mounting), and `LVB-4015` (physical-location search and precise positioning). These are prepared as formal frontend task packages, but each depends on a matching minimal backend patch before frontend execution should begin. | fixed |
| 2026-03-23 | LVB-4013 backend baseline delivered | Completed the minimal Asset clean-slate backend patch: create no longer accepts frontend-supplied `asset_code`; `asset_code` is now backend-generated via `asset_code_seq` as `AST-HJ-###`; Asset business ownership remains single-source on `project_id`; Asset read models now return the project's business-region UUID as `region_id`; and `manual_region_id` is no longer routed through business-region compatibility logic and now carries `region_reference.code` directly as the manual physical-location field. A real create smoke succeeded without sending `asset_code`, returned `AST-HJ-001`, and the temporary smoke row was deleted immediately after verification. `db:seed:demo` still has a separate old-seed issue in `002_assets.sql`, but `001_reference + 002b_project_asset_contract` verified the 4013 baseline itself. | fixed |
| 2026-03-24 | COD-2026-03-24-001 maintenance-team backend baseline delivered | Added the minimal `maintenance_team` backend baseline under clean-slate rules: new `maintenance_team` table plus `project.maintenance_team_id` and `asset.maintenance_team_id`, REST endpoints for list/options/create/update/detail, Project default-team read model, Asset override-team and effective-team read model, focused e2e coverage, and cleanup inclusion so maintenance-team demo/test data does not linger after verification. This is the required backend baseline before any frontend `LVB-4014` execution. | fixed |

## Process rule

Before deciding that "backend is missing something", check in this order:

1. domain layering
2. relation model
3. location model
4. compatibility mapping
5. frontend/backend contract checklist
6. current backend module behavior or OpenAPI
7. existing smoke tests
8. active frontend task package and context
9. only then decide whether the issue is A / B / C

This file is the default record for future Lovable <-> Codex issue circulation.
