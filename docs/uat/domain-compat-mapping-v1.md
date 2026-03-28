# Domain Compatibility Mapping v1

Status: frozen compatibility reference  
Audience: frontend, backend, and UAT

## Why this document exists

The current Phase 1 pages and APIs were built before the model was re-frozen.

This document explains how to interpret those pages and endpoints under the new domain model without renaming everything in this turn.

## Mapping summary

| Current page / API concept | New domain interpretation | Current status | Frontend rule |
|---|---|---|---|
| `wells` page / `GET /api/v1/wells` | asset list filtered to `asset_type = well` | compatibility view | Do not expand as final generic asset CRUD. |
| `POST/PATCH /api/v1/wells` | compatibility editor for well assets only | compatibility form | Use only when a future task explicitly reopens it. |
| `devices` page / `GET /api/v1/devices` | device ledger | valid compatibility read | Keep as device ledger meaning, not "device directly under region forever". |
| `POST/PATCH /api/v1/devices` | compatibility editor for the device ledger | compatibility form | Do not infer final asset binding/location semantics from current payload names alone. |
| `pump-valve-relations` page | specialized device relation view | compatibility view | Not the final generic relation editor. |
| `GET /api/v1/regions` | region administration read | valid current read | Must now be understood as administrative region tree semantics. |
| `POST/PATCH /api/v1/regions` | region edit form | provisional but real | Do not overload as project/asset proxy. |
| `device-types` page | device type dictionary | valid dictionary object | Safe to keep as dictionary meaning. |
| `billing-packages` page | billing package dictionary | valid dictionary object | Keep after core domain freeze, not before. |
| `well-runtime-policies` page | policy dictionary tied to well assets | valid specialized dictionary | Do not let it redefine the asset/device master-data model. |

## Current field-level compatibility notes

### wells

Current payload / list fields:

- `deviceId`
- `wellCode`
- `waterSourceType`
- display aliases like `name`, `area`, `pump_model`, `status`

Frozen interpretation:

- `deviceId` is a compatibility shortcut around the future asset-device binding
- `wellCode` is really a compatibility code for the well asset
- `area` is a derived region display, not a free-input field
- `pump_model` is a derived/spec field, not a universal master-data field

### devices

Current payload / list fields:

- `deviceTypeId`
- `regionId`
- `deviceCode`
- `deviceName`
- `serialNo`
- `protocolType`
- display aliases like `type`, `area`, `well`, `status`

Frozen interpretation:

- `deviceTypeId`, `deviceCode`, `deviceName` remain valid device-ledger fields
- `regionId` is a compatibility field, not the final long-term primary bind
- `well` is a derived display alias for the bound asset context
- `status` is runtime/display state, not a free editable master field

### pump-valve-relations

Current payload / list fields:

- `wellId`
- `pumpId`
- `valveId`
- `relationRole`
- display aliases like `well`, `pump`, `valve`, `sequence`, `status`

Frozen interpretation:

- this is a specialized irrigation relation view
- the ids currently point to specialized compatibility objects
- the final broader domain will separate:
  - asset tree
  - asset relations
  - asset-device bindings
  - device relations

## Practical frontend rule

- Keep existing page names for now.
- Reinterpret their meaning through the frozen domain docs.
- Do not use the current page names as proof of the final master-data model.
