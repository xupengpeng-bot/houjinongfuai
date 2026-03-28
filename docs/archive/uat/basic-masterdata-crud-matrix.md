# Phase 1 Basic Master Data CRUD Matrix

Status: frozen after domain reset  
Audience: frontend implementation, backend contract review, UAT alignment  
Scope: what the frontend may treat as CRUD in the current phase, after the new Region -> Project -> Asset -> Device model freeze

## Reading rule

- This file answers one operational question first: "May the frontend implement CRUD for this object now?"
- The answer is no longer driven only by route existence. It is driven by the frozen domain model.
- Current frontend CRUD attempts around `wells`, `devices`, and `pump-valve-relations` are exploratory only. They are not the final model boundary.
- Runtime, workflow, aggregate, and action endpoints must not be turned into generic CRUD.

## Buckets

- `Paused after exploratory round`
  - A page or endpoint exists, but the domain meaning has been re-frozen and the old CRUD direction must not expand further until the next task is issued.
- `Next implementation wave`
  - The object belongs to the new canonical domain model and should be implemented only after the new model is adopted in order.
- `Read only / action only`
  - The object may have read or action endpoints, but it is not a generic CRUD target in this phase.

## Matrix

| Object | Canonical domain role | Current API / compatibility view | Bucket | Current backend capability | In current frontend scope | Notes |
|---|---|---|---|---|---|---|
| regions | Administrative region tree | `GET /api/v1/regions`, `GET /api/v1/regions/tree`, `POST /api/v1/regions`, `PATCH /api/v1/regions/:id` | Next implementation wave | list/tree/create/update | yes | Region stays a real CRUD object, but must now be understood as an administrative tree, not a generic "area" bucket. |
| projects | Project under region | no first-class project API today | Next implementation wave | not yet first-class | no | Project is now a frozen canonical layer. Do not fake it by overloading region forms further. |
| assets | Asset under project, supports parent/child tree | no generic asset API today | Next implementation wave | not yet first-class | no | Asset is the new canonical layer above device. Current well/pump/valve tables are compatibility slices of this domain. |
| asset tree | Parent/child asset structure | not exposed as generic API today | Next implementation wave | not yet first-class | no | Needed before broader master-data CRUD can be considered complete. |
| asset relations | Asset-to-asset business relation model | not exposed as generic API today | Next implementation wave | not yet first-class | no | Separate from parent/child tree. |
| asset-device bindings | Device bound to one asset | currently implicit in specialized tables | Next implementation wave | partial / implicit | no | Must become explicit in future design, but is not a separate CRUD page yet. |
| devices | Device ledger under asset | `GET /api/v1/devices`, `GET /api/v1/devices/:id`, `POST /api/v1/devices`, `PATCH /api/v1/devices/:id` | Paused after exploratory round | list/detail/create/update | yes | Keep the current ledger as a compatibility surface, but do not expand forms until the asset/device/location rules are adopted. |
| device-types | Device type dictionary | `GET /api/v1/device-types`, `POST /api/v1/device-types`, `PATCH /api/v1/device-types/:id` | Next implementation wave | list/create/update | yes | Still a valid dictionary object, but should be aligned to the new device ledger semantics before frontend rollout resumes. |
| wells | Compatibility view of `asset_type = well` | `GET /api/v1/wells`, `GET /api/v1/wells/:id`, `POST /api/v1/wells`, `PATCH /api/v1/wells/:id` | Paused after exploratory round | list/detail/create/update | yes | "Well" is now frozen as an asset, not the final standalone master-data root. Existing routes remain compatibility routes only. |
| pumps | Compatibility view of `asset_type = pump` | `GET /api/v1/pumps`, `GET /api/v1/pumps/:id`, `POST /api/v1/pumps`, `PATCH /api/v1/pumps/:id` | Next implementation wave | list/detail/create/update | no | Treat as asset compatibility view, not as separate final root CRUD. |
| valves | Compatibility view of `asset_type = valve` | `GET /api/v1/valves`, `GET /api/v1/valves/:id`, `POST /api/v1/valves`, `PATCH /api/v1/valves/:id` | Next implementation wave | list/detail/create/update | no | Same rule as pumps. |
| pump-valve-relations | Specialized device relation view | `GET /api/v1/pump-valve-relations`, `POST /api/v1/pump-valve-relations`, `PATCH /api/v1/pump-valve-relations/:id` | Paused after exploratory round | list/create/update | yes | This is no longer the final relation model. It is a specialized view over the broader relation domain. |
| device-relations | Generic device-to-device technical relation model | not exposed as generic API today | Next implementation wave | not yet first-class | no | Canonical target for control, linkage, interlock, gateway, and master/slave relations. |
| billing-packages | Billing package dictionary | `GET /api/v1/billing-packages`, `POST /api/v1/billing-packages`, `PATCH /api/v1/billing-packages/:id` | Next implementation wave | list/create/update | partial | Keep after asset/device/domain freeze is absorbed. |
| well-runtime-policies | Runtime policy dictionary | `GET /api/v1/well-runtime-policies`, `POST /api/v1/well-runtime-policies`, `PATCH /api/v1/well-runtime-policies/:id` | Next implementation wave | list/create/update plus preview | partial | Do not let this drive domain modeling for assets/devices. |
| users | Account and permission object | `GET /api/v1/system/users`, `POST /api/v1/system/users`, `PATCH /api/v1/system/users/:id` | Next implementation wave | list/create/update | partial | Not part of the current master-data re-freeze rollout. |
| roles | Permission reference object | `GET /api/v1/system/roles` | Read only / action only | list only | no | Reference data, not first-wave CRUD. |
| permissions | Permission reference object | `GET /api/v1/system/permissions` | Read only / action only | list only | no | Reference data, not first-wave CRUD. |
| alerts | Workflow / event object | `GET /api/v1/alerts`, `GET /api/v1/alerts/:id`, `PATCH /api/v1/alerts/:id` | Read only / action only | list/detail/status update | yes | Not a generic CRUD object. |
| work-orders | Workflow object | `GET /api/v1/work-orders`, `GET /api/v1/work-orders/:id`, `POST /api/v1/work-orders` | Read only / action only | list/detail/create plus workflow actions | yes | Not a generic CRUD object. |
| uat-cases | Test asset object | `GET /api/v1/uat/cases`, `POST /api/v1/uat/cases` | Read only / action only | list/create | yes | Not a priority CRUD object in this master-data freeze. |
| uat-executions | Execution record object | `GET /api/v1/uat/executions` | Read only / action only | list only | no | Read only evidence object. |
| orders | Runtime business object | `GET /api/v1/orders`, `GET /api/v1/orders/:id` | Read only / action only | list/detail | yes | Never treat as generic CRUD. |
| farmer-orders | Farmer history read | `GET /api/v1/u/orders` | Read only / action only | list only | yes | History only. |
| run-sessions | Runtime business object | `GET /api/v1/run-sessions` | Read only / action only | list only | yes | Never treat as generic CRUD. |
| current-session | Farmer runtime card | `GET /api/v1/farmer/session/active` | Read only / action only | read only | yes | Read model only. |
| runtime-start-check | Runtime action | `POST /api/v1/u/runtime/start-check` | Read only / action only | action only | yes | Not CRUD. |
| runtime-sessions | Runtime action | `POST /api/v1/u/runtime/sessions` | Read only / action only | action only | yes | Not CRUD. |
| runtime-stop | Runtime action | `POST /api/v1/u/runtime/sessions/:id/stop` | Read only / action only | action only | yes | Not CRUD. |
| dashboard-stats | Aggregate read model | `GET /api/v1/dashboard/stats` | Read only / action only | read only | yes | Aggregate only. |

## Frozen guidance for the current exploratory pages

- `wells`
  - Freeze the meaning as "asset list filtered to primary asset type = well".
  - Do not keep expanding the old well form as if it were the final asset CRUD.
- `devices`
  - Freeze the meaning as "device ledger bound to assets".
  - Do not keep expanding the old device form as if region, area, and well display fields were the final editable model.
- `pump-valve-relations`
  - Freeze the meaning as "specialized relation page", not the final universal relation editor.

## Immediate rule for frontend work

Until the next explicit task is issued, do not expand CRUD beyond the current exploratory round.

Before implementing anything new, read in this order:

1. `domain-region-project-asset-device-v2.md`
2. `relation-model-v2.md`
3. `location-model-v1.md`
4. `domain-compat-mapping-v1.md`
5. `basic-masterdata-crud-matrix.md`
6. `basic-masterdata-field-dictionary.md`
7. `basic-masterdata-form-contracts.md`
