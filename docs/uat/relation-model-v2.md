# Relation Model v2

Status: frozen semantic reference  
Audience: frontend, backend, and UAT

## Why this document exists

The current `pump-valve-relations` page is useful, but it is only one narrow relation view. It must not be mistaken for the final universal relation model.

This document freezes four relation layers.

## 1. asset_tree

Purpose:

- structural parent/child relationship between assets

Examples:

- well -> pump
- well -> pipe
- well -> elbow
- well -> power_box
- pump_station -> pump
- valve_group -> child valve asset

Key fields:

- `parent_asset_id`
- `child_asset_id`
- `child_order` (optional)
- `enabled`

Important rule:

- This is structural containment, not a general business relation.

## 2. asset_relations

Purpose:

- business relation between assets that are not simply parent/child

Examples:

- well coordinated with another well
- pump station supplying multiple wells
- weather point covering a control zone
- one asset serving as backup for another asset

Suggested relation categories:

- `supply`
- `coverage`
- `coordination`
- `backup`
- `dependency`
- `constraint`

Important rule:

- Do not overload parent/child tree for these cross-asset relations.

## 3. asset_device_bindings

Purpose:

- bind a device to the asset it serves

Examples:

- well controller -> well
- weather station terminal -> weather point
- pump controller -> pump or pump station
- flow meter -> well or pipe segment
- camera -> well house or pump station

Key fields:

- `asset_id`
- `device_id`
- `binding_role`
- `is_primary`
- `enabled`

Important rule:

- This is the canonical place to express "which device belongs to which asset".
- It replaces implicit guessing from page labels such as `well`, `pump`, or `valve`.

## 4. device_relations

Purpose:

- technical relation between devices

Examples:

- control
- linkage
- interlock
- master/slave
- gateway uplink
- execution sequence
- execution delay

Suggested relation categories:

- `controls`
- `linked_with`
- `interlocks_with`
- `master_of`
- `slave_of`
- `connected_via_gateway`
- `starts_before`
- `stops_before`

Key fields:

- `source_device_id`
- `target_device_id`
- `relation_type`
- `direction`
- `priority`
- `delay_sec`
- `enabled`
- `config_json`

## 5. Where pump-valve-relations fits

Current `pump-valve-relations` is not the final relation root.

It should be understood as:

- a specialized business/technical view
- currently optimized for the irrigation runtime use case
- effectively a subset of the broader `device_relations` model, with extra domain fields tied to the well-control scenario

Important rule:

- Keep the current page as a specialized view.
- Do not treat it as proof that the total relation domain is fully modeled.
