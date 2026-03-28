# Phase 1 Basic Master Data Field Dictionary

Status: frozen after domain reset  
Audience: frontend implementation, backend contract review, UAT review  
Scope: frozen domain meaning plus current compatibility naming

## Reading rule

- This dictionary is written from a frontend consumption view, not from raw entity names alone.
- A field may exist in current compatibility APIs without being part of the frozen final domain contract.
- Do not treat display aliases such as `area`, `well`, `pump`, `valve`, or `location` as free-input fields.
- Field groups are intentionally split into:
  - `Editable master data`
  - `Communication identity`
  - `Runtime state`
  - `Derived display`
  - `Relation fields`

## 1. Region

Canonical meaning: administrative region tree only.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `id` | database primary key | string | `00000000-0000-0000-0000-000000000201` | yes | yes | yes | no | no | yes | internal id | Never typed by end users. |
| `parent_id` | parent region id | string | `...0200` | no | no | yes | yes | yes | no | root may be null | Tree structure key. |
| `level` | administrative level | string | `county` | yes | yes | yes | yes | yes | no | `province`, `city`, `county`, `town`, `village` | Replaces generic region type semantics for the frozen model. |
| `code` | region code | string | `610431001` | yes | yes | yes | yes | yes | no | unique in tenant | Use a stable admin-style code. |
| `name` | region name | string | `Wugong County` | yes | yes | yes | yes | yes | no | - | Editable master field. |
| `full_path_name` | full region path for display | string | `Shaanxi / Xianyang / Wugong County` | yes | yes | yes | no | no | yes | derived | Derived from parent chain. |
| `full_path_code` | full region path code | string | `61/6104/610431` | yes | no | yes | no | no | yes | derived | Derived from parent chain. |
| `enabled` | active flag | boolean | `true` | yes | yes | yes | yes | yes | no | - | Administrative availability flag. |

## 2. Project

Canonical meaning: project under one primary region.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `id` | database primary key | string | `00000000-0000-0000-0000-000000000301` | yes | yes | yes | no | no | yes | internal id | Not a free-input field. |
| `project_code` | project code | string | `PRJ-HJ-001` | yes | yes | yes | yes | yes | no | unique in tenant | Editable master field. |
| `project_name` | project name | string | `Houji North Irrigation Demo` | yes | yes | yes | yes | yes | no | - | Editable master field. |
| `region_id` | primary region id | string | `...0201` | yes | no | yes | yes | yes | no | fk to region | Chosen from region tree. |
| `region_name` | primary region display | string | `Wugong County` | yes | yes | yes | no | no | yes | derived | Display only. |
| `status` | project status | string | `active` | yes | yes | yes | yes | yes | no | `draft`, `active`, `paused`, `closed` | Frozen business enum. |
| `owner` | business owner | string | `County Water Bureau` | no | yes | yes | yes | yes | no | - | Editable text. |
| `operator` | operating party | string | `Houji Operations Team` | no | yes | yes | yes | yes | no | - | Editable text. |
| `remarks` | notes | string | `Phase 1 demo scope` | no | no | yes | yes | yes | no | - | Long text. |

## 3. Asset

Canonical meaning: project-owned physical or structural object. Supports parent/child tree.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `id` | database primary key | string | `00000000-0000-0000-0000-000000000501` | yes | yes | yes | no | no | yes | internal id | Never typed by end users. |
| `asset_code` | asset code | string | `AST-WELL-S01-001` | yes | yes | yes | yes | yes | no | unique in tenant | Editable master field. |
| `asset_name` | asset name | string | `S01 Demo Well` | yes | yes | yes | yes | yes | no | - | Editable master field. |
| `asset_type` | asset type | string | `well` | yes | yes | yes | yes | yes | no | `well`, `pump_station`, `weather_point`, `pump`, `pipe`, `elbow`, `valve_group`, `control_zone`, `power_box`, `well_house` | Frozen domain enum. |
| `parent_asset_id` | parent asset id | string | `...0501` | no | no | yes | yes | yes | no | fk to asset | Defines asset tree. |
| `project_id` | owning project id | string | `...0301` | yes | no | yes | yes | yes | no | fk to project | Editable via project selection. |
| `project_name` | owning project display | string | `Houji North Irrigation Demo` | yes | yes | yes | no | no | yes | derived | Display only. |
| `region_id` | derived region id | string | `...0201` | yes | no | yes | no | no | yes | derived from project | Not directly typed when project exists. |
| `region_name` | derived region display | string | `Wugong County` | yes | yes | yes | no | no | yes | derived | Replaces generic `area` field in the frozen model. |
| `lifecycle_status` | asset lifecycle status | string | `active` | yes | yes | yes | yes | yes | no | `draft`, `active`, `disabled`, `scrapped` | Master-data state. |
| `install_status` | installation status | string | `installed` | yes | yes | yes | yes | yes | no | `planned`, `installing`, `installed`, `uninstalled` | Master-data state. |

## 4. Device

Canonical meaning: independently identifiable, communicable, reportable, or controllable object bound to one asset.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `id` | database primary key | string | `00000000-0000-0000-0000-000000000411` | yes | yes | yes | no | no | yes | internal id | Never typed by end users. |
| `device_code` | business device code | string | `DEV-S01-PUMP-001` | yes | yes | yes | yes | yes | no | unique in tenant | Editable master field. |
| `device_name` | device display name | string | `S01 Pump Controller` | yes | yes | yes | yes | yes | no | - | Editable master field. |
| `device_type_id` | device type id | string | `...0302` | yes | no | yes | yes | yes | no | fk to device type | Form selection field. |
| `device_type` | device type display | string | `pump_controller` | yes | yes | yes | no | no | yes | derived display | Never free text when a type dictionary exists. |
| `asset_id` | bound asset id | string | `...0501` | yes | no | yes | yes | yes | no | fk to asset | Replaces free-text `well` / `pump` / `valve` linkage. |
| `asset_name` | bound asset display | string | `S01 Demo Well` | yes | yes | yes | no | no | yes | derived | Display only. |
| `project_id` | derived project id | string | `...0301` | yes | no | yes | no | no | yes | derived from asset | Not a free-input field. |
| `region_id` | derived region id | string | `...0201` | yes | no | yes | no | no | yes | derived from asset/project or manual location | Not a free-input text box. |

## 5. Device communication identity

These fields belong to device identity, not to free-form business description.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `comm_identity_type` | communication identity type | string | `imei` | yes | yes | yes | no | limited | preferred read only | `imei`, `chip_sn` | Derived from hardware capability. |
| `comm_identity_value` | communication identity value | string | `860000000000411` | yes | yes | yes | no | limited | preferred read only | unique business communication key | Canonical routing key. |
| `imei` | IMEI value | string | `860000000000411` | no | yes | yes | no | limited | preferred read only | used when device has 4G module | Do not make it a casual text field everywhere. |
| `chip_sn` | chip serial number | string | `SN-CTRL-001` | no | yes | yes | no | limited | preferred read only | used when there is no IMEI | Same rule as IMEI. |
| `iccid` | SIM card ICCID | string | `898600xxxxxxxxxxxx` | no | no | yes | no | limited | preferred read only | telecom metadata | Usually device/module sourced. |
| `module_model` | communication module model | string | `EC200U` | no | no | yes | no | limited | preferred read only | module metadata | Usually device or provisioning sourced. |
| `firmware_version` | firmware version | string | `1.0.7` | no | yes | yes | no | no | yes | runtime-reported | Not a manual business field. |

## 6. Manual / reported / effective location

The system must not collapse these into one ambiguous `location` field.

### 6.1 Manual location

Editable by human operators.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `manual_region_id` | manually chosen region | string | `...0201` | no | no | yes | yes | yes | no | fk to region | Select from region tree. |
| `manual_address_text` | manual address text | string | `North side of village road` | no | no | yes | yes | yes | no | - | Human-entered description. |
| `manual_latitude` | manual latitude | number | `34.2581` | no | no | yes | yes | yes | no | decimal degrees | Editable. |
| `manual_longitude` | manual longitude | number | `108.1970` | no | no | yes | yes | yes | no | decimal degrees | Editable. |
| `install_position_desc` | install position description | string | `Inside well house cabinet` | no | no | yes | yes | yes | no | - | Editable for both assets and devices. |
| `location_source_strategy` | location source rule | string | `manual_preferred` | yes | no | yes | yes | yes | no | `manual_preferred`, `reported_preferred`, `auto` | Controls effective location derivation. |

### 6.2 Reported location

Reported location comes from device telemetry or a trusted import pipeline.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `reported_latitude` | last reported latitude | number | `34.2580` | no | no | yes | no | no | yes | telemetry-sourced | Never typed manually in normal forms. |
| `reported_longitude` | last reported longitude | number | `108.1968` | no | no | yes | no | no | yes | telemetry-sourced | Read only. |
| `reported_at` | last reported timestamp | string | `2026-03-22T10:15:00Z` | no | yes | yes | no | no | yes | ISO timestamp | Read only. |
| `reported_source` | source of reported location | string | `gps` | no | yes | yes | no | no | yes | `gps`, `base_station`, `gateway`, `manual_import` | Read only. |

### 6.3 Effective location

Effective location is the system-chosen location used for map display and search.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `effective_latitude` | effective latitude | number | `34.2581` | no | yes | yes | no | no | yes | derived | Never free input. |
| `effective_longitude` | effective longitude | number | `108.1970` | no | yes | yes | no | no | yes | derived | Never free input. |
| `effective_location_source` | effective location source | string | `manual` | yes | yes | yes | no | no | yes | `manual`, `reported`, `auto` | Derived from strategy plus data availability. |

## 7. Device runtime state fields

These are display fields only.

| Field | Meaning | Type | Example | Required | List | Detail | Create | Edit | Read only | Enum / note | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `status` | page status badge value | string | `online` | yes | yes | yes | no | no | yes | page-level normalized state | Not a master-data field. |
| `online_state` | raw connectivity state | string | `online` | no | no | yes | no | no | yes | backend runtime state | Read only. |
| `lifecycle_state` | lifecycle state | string | `active` | no | no | yes | no | no | yes | backend state | Only editable through dedicated lifecycle flow, not free text. |
| `runtime_state` | runtime state | string | `idle` | no | no | yes | no | no | yes | backend runtime state | Read only. |
| `last_report` | last report display time | string | `2026-03-22 11:15` | no | yes | yes | no | no | yes | display alias | Read only. |

## 8. Compatibility display aliases that are not final input fields

These names may appear in current list reads, but they are not final free-input fields.

| Field | Final meaning | Input rule | Notes |
|---|---|---|---|
| `type_id` | foreign key such as `device_type_id` | selected from dictionary, not typed | Keep as fk semantics. |
| `type` | derived type display | read only | Do not store as manual label if a type dictionary exists. |
| `region` | derived region display | read only | Use `region_id` / `manual_region_id` instead. |
| `project` | derived project display | read only | Use `project_id` instead. |
| `asset` | derived bound asset display | read only | Use `asset_id` instead. |
| `well` | compatibility display alias for well asset | read only | Not a generic field across all objects. |
| `pump` | compatibility display alias for pump asset | read only | Same rule. |
| `valve` | compatibility display alias for valve asset | read only | Same rule. |
| `pump_model` | device or attached asset spec display | read only or specialized spec form only | Not a generic master-data field across all objects. |
| `flow_rate` | spec or telemetry-derived numeric | specialized field only | Do not treat as universal free-input field. |
| `area` | old display alias for region scope | read only | Replace with explicit region/project derivation. |
| `location` | ambiguous old display label | forbidden as generic free-input field | Split into manual/reported/effective fields. |

## Frontend rule summary

- A field visible in a list does not automatically mean it is editable.
- Communication identity fields are not general-purpose text inputs.
- Runtime state fields are read only.
- Region, project, asset, and relation fields must be chosen structurally, not entered as free text.
- Manual location is editable; reported location and effective location are read only.
