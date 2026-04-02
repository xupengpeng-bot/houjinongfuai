# Archive Strategy

## Goal

Keep online business tables focused on active data, while preserving full historical traceability for cleanup, replacement, and manual deletion flows.

This phase introduces:

- `device_archive`
- `asset_archive`
- `archive_operation_log`

And wires archive writes into:

- `DELETE /devices/:id`
- `DELETE /assets/:id`
- `POST /devices/:id/archive`
- `POST /assets/:id/archive`

## Why

The previous device delete flow only changed `device.lifecycle_state = 'archived'`.

That caused three problems:

1. Archived rows still occupied `UNIQUE (tenant_id, device_code)`.
2. Archived rows still referenced `asset_id`, which blocked later asset cleanup.
3. There was no first-class archive snapshot describing why the row was archived and from which business entry it came.

Assets had the inverse problem: they were physically deleted, but without a dedicated archive snapshot.

## Current behavior

### Device archive

`DELETE /devices/:id` now performs one transaction:

1. Read current active device snapshot.
2. Insert a full snapshot into `device_archive`.
3. Insert an operation trace into `archive_operation_log`.
4. Rewrite the live `device` row into an archived tombstone:
   - `lifecycle_state = 'archived'`
   - `device_code` rewritten to a released archive code
   - `serial_no` rewritten to the same released archive code
   - `asset_id = null`

This keeps historical FKs on `device.id` intact, while releasing the online business code and detaching archived rows from assets.

### Asset archive

`DELETE /assets/:id` now performs one transaction:

1. Validate there are no child assets.
2. Validate there are no metering points referencing the asset.
3. Insert a full snapshot into `asset_archive`.
4. Insert an operation trace into `archive_operation_log`.
5. Physically delete the active row from `asset`.

## Traceability model

Archive tracking is intentionally split into two layers:

### 1. Archive snapshot tables

Use `device_archive` / `asset_archive` to answer:

- What exactly was archived?
- What did the entity look like at that moment?

Each row stores:

- original business ID
- original business code
- entity name
- archive reason
- trigger type
- source module and action
- request / batch / UI entry metadata
- operator metadata
- full `snapshot_json`

### 2. Archive operation log

Use `archive_operation_log` to answer:

- How did it enter the archive table?
- Was it a manual delete, automatic cleanup, or replacement flow?
- Which module or UI entry triggered it?

Important fields:

- `archive_table`
- `archive_record_id`
- `origin_table`
- `origin_id`
- `origin_code`
- `operation_type`
- `trigger_type`
- `archive_reason`
- `reason_text`
- `source_module`
- `source_action`
- `ui_entry`
- `request_id`
- `batch_id`
- `operator_id`
- `operator_name`
- `snapshot_json`

## Design rules

### Archive tables are not online business tables

Archive tables should not enforce online consistency rules.

Recommended:

- keep PKs
- keep query indexes
- keep non-null fields required for traceability
- store denormalized business snapshots in `snapshot_json`

Avoid:

- strong FK chains back into active business tables
- active-business uniqueness constraints
- validations that block archive writes because an active relation has already changed

### Active tables still own live integrity

Online FKs, business uniqueness, and status transitions remain in active tables:

- `device`
- `asset`
- `metering_point`
- `project`
- `project_block`

Archive tables exist to preserve history, not to participate in online domain rules.

## Recommended next rollout

### High priority

1. Add query APIs for archive history lookup by `origin_id` / `origin_code`.
2. Surface archive reason and trigger source in admin tooling.
3. Extend explicit archive semantics to more replacement flows.

## Current explicit archive callers

### Manual business delete

- `DELETE /devices/:id`
- `DELETE /assets/:id`

These keep backward compatibility for existing screens and default to `manual_delete`.

### Explicit archive with caller metadata

- `POST /devices/:id/archive`
- `POST /assets/:id/archive`

These endpoints accept archive metadata and are intended for automated business flows that need stronger traceability.

Current front-end caller:

- `network-workbench` batch initialization cleanup

It sends:

- `archive_reason`
- `trigger_type = batch_initialize_cleanup`
- `source_module = network-workbench`
- `source_action = NetworkConfigWorkbenchPage.handleBatchInitializeAssets`
- `ui_entry = network_workbench.batch_initialize`
- `batch_id`

### Archive history lookup

- `GET /archive/operations`

Current supported filters:

- `origin_table`
- `origin_id`
- `origin_code`
- `archive_reason`
- `trigger_type`
- `batch_id`
- `source_module`

Current front-end entry points:

- `/ops/archive`
- `network-workbench` node detail sheet, from linked asset/device rows into archive history lookup

### Good next candidates

1. `metering_point`
   Because it bridges active asset/device references and may also need replacement history.
2. Selected replacement flows in `network-workbench`
   Such as batch initialize cleanup, rebind, and device replacement.

### Not recommended as first archive-table targets

These are better handled by status/versioning/cold-storage patterns rather than archive tables:

- `project`
- `project_block`
- `region`
- `device_type`
- runtime / event / order tables
- `network_model_version`

## Operational guidance

When cleanup/archive fails:

1. The business-critical operation should be classified first.
2. Archive/cleanup must not block unrelated successful work unless strict consistency truly requires it.
3. Failures should be logged with enough metadata to retry later.

For this codebase, batch initialization cleanup is a compensating action, not the primary business outcome. It should prefer successful current-state initialization plus traceable cleanup records over hard failure caused by historical archive debt.
