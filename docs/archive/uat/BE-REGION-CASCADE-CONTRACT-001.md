# BE-REGION-CASCADE-CONTRACT-001

Status: proposed minimal backend contract patch  
Owner: Codex  
Purpose: unblock real-mode support for standard administrative-region cascade in Region / Project / Asset forms

## 1. Why this patch is needed

Current frontend experience closure for Region / Project / Asset needs a standard administrative cascade:

- province
- city
- county
- town
- village

Current backend `GET /api/v1/regions/options` is not sufficient as the long-term real-mode source because:

- it returns a flat options list
- it does not provide a stable parent-child chain for direct cascade consumption
- its current `level` values are derived from legacy compatibility `region_type`
- current seed data does not provide a clean province -> city -> county -> town -> village demo chain

This is a minimal contract gap, not a reason to redesign the whole region model in this turn.

## 2. Patch goal

Keep the current backend stable, but add the minimum data contract needed so the frontend can consume standard administrative cascade data without guessing.

## 3. Minimal patch scope

Preferred route strategy:

- keep existing `GET /api/v1/regions/options` for backward compatibility
- add one cascade-friendly read, for example:
  - `GET /api/v1/regions/cascade-options`

Alternative acceptable strategy:

- extend `GET /api/v1/regions/options` so it can already serve cascade shape without breaking current selector consumers

## 4. Minimum response shape

The response should provide enough information for cascade selection and `level` inference.

Minimum fields per node:

- `id`
- `parent_id`
- `value`
- `label`
- `code`
- `name`
- `level`
- `full_path_name`
- `full_path_code`
- `enabled`

Preferred:

- nested `children`

If the backend keeps a flat list instead of nested tree, it must still provide:

- `parent_id`
- canonical `level`

so the frontend can build a stable cascade locally.

## 5. Canonical level values

The backend should expose canonical administrative levels only:

- `province`
- `city`
- `county`
- `town`
- `village`

It should not leak legacy compatibility meanings like:

- `project`
- `service_area`
- `plot_group`
- `plot`

into the frontend cascade contract.

## 6. Seed requirement

The current seed should include at least one full five-level example chain:

- province
- city
- county
- town
- village

so Region / Project / Asset real-mode forms have deterministic data for:

- cascade display
- `level` auto-fill
- `full_path_name` display
- `manual_region_id` selection

## 7. Non-goals

This patch must not do any of the following:

- redesign the full region domain
- mix project or asset semantics back into Region
- expand runtime behavior
- change payment, billing, or device logic
- introduce a map service

## 8. Acceptance check

This patch is considered enough when:

1. frontend can read administrative cascade data to village level
2. frontend can infer or directly consume canonical `level`
3. Region forms do not need to guess parent chain
4. Project and Asset forms can reuse the same region source for selectors
