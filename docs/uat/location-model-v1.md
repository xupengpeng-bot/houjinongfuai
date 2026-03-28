# Location Model v1

Status: frozen semantic reference  
Audience: frontend, backend, and UAT

## Why this document exists

The old generic `location` idea is too ambiguous.

Both assets and devices need a location model, and the system must distinguish:

- manual location
- reported location
- effective location

## 1. Manual location

Manual location is entered or adjusted by operators.

Recommended fields:

- `manual_region_id`
- `manual_address_text`
- `manual_latitude`
- `manual_longitude`
- `install_position_desc`
- `location_source_strategy`

Rules:

- editable in frontend forms
- applies to both assets and devices
- should be the only location layer edited in ordinary forms

## 2. Reported location

Reported location comes from device telemetry or a trusted import pipeline.

Recommended fields:

- `reported_latitude`
- `reported_longitude`
- `reported_at`
- `reported_source`

Rules:

- read only in forms
- not a casual manual override field
- may be unavailable for many non-communicating assets

## 3. Effective location

Effective location is the system-chosen location used for map display and search.

Recommended fields:

- `effective_latitude`
- `effective_longitude`
- `effective_location_source`

Rules:

- read only in forms
- derived from strategy plus data availability
- should be what list pages and maps display by default

## 4. Strategy

Recommended strategy field:

- `location_source_strategy`
  - `manual_preferred`
  - `reported_preferred`
  - `auto`

Recommended behavior:

- `manual_preferred`
  - use manual location when present, otherwise reported location
- `reported_preferred`
  - use reported location when valid, otherwise manual location
- `auto`
  - let the backend choose by current confidence rule

## 5. Asset versus device editing rule

For both asset and device:

- manual location: editable
- reported location: read only
- effective location: read only

Important rule:

- frontend forms should not expose one generic `location` text field as the main source of truth
- region selection and coordinates must be explicit
