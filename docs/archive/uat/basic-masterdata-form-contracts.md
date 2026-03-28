# Phase 1 Basic Master Data Form Contracts

Status: frozen after domain reset  
Audience: frontend form implementation  
Scope: current compatibility endpoints plus the new domain-freeze rules

## Reading rule

- This file exists to stop the frontend from guessing which form is safe to build.
- Route existence is not enough. The form must also match the frozen domain model.
- Current `wells`, `devices`, and `pump-valve-relations` forms are compatibility forms only. They are not the final domain forms.
- No object in this file implies delete support unless an actual delete route exists.

## 1. Region form contract

### Role in the frozen model

- Real CRUD object
- Administrative region tree only
- Not a generic project/asset scope bucket

### APIs

- List: `GET /api/v1/regions`
- Tree: `GET /api/v1/regions/tree`
- Detail: none
- Create: `POST /api/v1/regions`
- Update: `PATCH /api/v1/regions/:id`
- Delete: none

### Current create payload

```json
{
  "parentId": "00000000-0000-0000-0000-000000000200",
  "regionCode": "REG-610431001",
  "regionName": "Demo Town",
  "regionType": "service_area"
}
```

### Current update payload

```json
{
  "regionName": "Demo Town East",
  "regionType": "service_area"
}
```

### Form rule

- Current backend payload still uses `regionType`, but the frozen domain meaning is administrative level.
- Frontend must treat this form as provisional until a dedicated administrative-level enum is aligned.
- Do not overload the region form to represent project or asset semantics.

### Required fields

- `regionCode`
- `regionName`
- `regionType` (compatibility field name for now)

### Read-only fields

- `id`
- `province`
- `city`
- `district`
- `wells`
- `devices`
- `status`

### Relationship fields

- `parentId`

### Typical success response

```json
{
  "code": "OK",
  "data": {
    "created": {
      "parentId": "00000000-0000-0000-0000-000000000200",
      "regionCode": "REG-610431001",
      "regionName": "Demo Town",
      "regionType": "service_area"
    }
  }
}
```

## 2. Device ledger form contract

### Role in the frozen model

- Compatibility form only
- Final meaning: device ledger bound to an asset
- Must not be expanded as if `region`, `well`, and `area` were final editable device fields

### APIs

- List: `GET /api/v1/devices`
- Detail: `GET /api/v1/devices/:id`
- Create: `POST /api/v1/devices`
- Update: `PATCH /api/v1/devices/:id`
- Delete: none

### Current create payload

```json
{
  "deviceTypeId": "00000000-0000-0000-0000-000000000302",
  "regionId": "00000000-0000-0000-0000-000000000201",
  "deviceCode": "DEV-S08-NEW",
  "deviceName": "Demo Pump Controller",
  "serialNo": "SN-S08-NEW",
  "protocolType": "tcp-json-v1"
}
```

### Current update payload

```json
{
  "deviceName": "Demo Pump Controller V2",
  "serialNo": "SN-S08-NEW-2",
  "protocolType": "tcp-json-v1"
}
```

### Form rule

- Current backend accepts `regionId`, because the generic asset/project layer is not yet first-class.
- In the frozen model, region is not the long-term primary editable relation on device. Device should bind to asset first, then derive project and region.
- Do not add more form fields that reinforce the old "device hangs directly under region" assumption.

### Required fields

- `deviceTypeId`
- `regionId` (compatibility field for now)
- `deviceCode`
- `deviceName`

### Read-only fields

- `id`
- `type`
- `area`
- `well`
- `status`
- `last_report`

### Enumerations and controlled fields

- `protocolType`
  - recommended current value: `tcp-json-v1`
- communication identity fields such as `imei`, `chip_sn`, `iccid`, `firmware_version`
  - do not add as free text inputs in this first form

### Typical success response

```json
{
  "code": "OK",
  "data": {
    "created": {
      "deviceTypeId": "00000000-0000-0000-0000-000000000302",
      "regionId": "00000000-0000-0000-0000-000000000201",
      "deviceCode": "DEV-S08-NEW",
      "deviceName": "Demo Pump Controller",
      "serialNo": "SN-S08-NEW",
      "protocolType": "tcp-json-v1"
    }
  }
}
```

## 3. Well form contract

### Role in the frozen model

- Compatibility form only
- Final meaning: asset form filtered to `asset_type = well`
- The current route must not be treated as the final generic asset CRUD contract

### APIs

- List: `GET /api/v1/wells`
- Detail: `GET /api/v1/wells/:id`
- Create: `POST /api/v1/wells`
- Update: `PATCH /api/v1/wells/:id`
- Delete: none

### Current create payload

```json
{
  "deviceId": "00000000-0000-0000-0000-000000000501",
  "wellCode": "WELL-S08-NEW",
  "waterSourceType": "groundwater"
}
```

### Current update payload

```json
{
  "deviceId": "00000000-0000-0000-0000-000000000501",
  "wellCode": "WELL-S08-NEW",
  "waterSourceType": "surface_water"
}
```

### Form rule

- In the frozen model, "well" is an asset.
- The current payload still carries `deviceId`, which is really a compatibility shortcut around the future asset-device binding.
- Do not generalize this form into the future asset tree editor.
- Do not add more fields based on the assumption that a well is the final top-level domain object.

### Required fields

- `deviceId`
- `wellCode`
- `waterSourceType`

### Read-only fields

- `id`
- `name`
- `area`
- `depth`
- `pump_model`
- `daily_usage`
- `monthly_usage`
- `status`

### Typical success response

```json
{
  "code": "OK",
  "data": {
    "created": {
      "deviceId": "00000000-0000-0000-0000-000000000501",
      "wellCode": "WELL-S08-NEW",
      "waterSourceType": "groundwater"
    }
  }
}
```

## 4. Pump-valve relation form contract

### Role in the frozen model

- Compatibility form only
- Final meaning: specialized relation editor over the broader relation model
- Not the final universal relation CRUD

### APIs

- List: `GET /api/v1/pump-valve-relations`
- Detail: none
- Create: `POST /api/v1/pump-valve-relations`
- Update: `PATCH /api/v1/pump-valve-relations/:id`
- Delete: none

### Current create payload

```json
{
  "wellId": "00000000-0000-0000-0000-000000000507",
  "pumpId": "00000000-0000-0000-0000-000000000607",
  "valveId": "00000000-0000-0000-0000-000000000707",
  "relationRole": "primary"
}
```

### Current update payload

```json
{
  "relationRole": "backup"
}
```

### Form rule

- Keep this page narrowly scoped.
- Do not turn it into a generic relation engine UI.
- In the frozen model, it is only one specialized relation view inside `device_relations`.

### Required fields

- create:
  - `wellId`
  - `pumpId`
  - `valveId`
  - `relationRole`

### Read-only fields

- `id`
- `well`
- `pump`
- `valve`
- `sequence`
- `valve_delay`
- `pump_delay`
- `status`

### Enumerations

- `relationRole`
  - `primary`
  - `backup`
  - `forbidden`

### Typical success response

```json
{
  "code": "OK",
  "data": {
    "created": {
      "id": "00000000-0000-0000-0000-000000001099"
    }
  }
}
```

## 5. Device type form contract

### Role in the frozen model

- Real dictionary object
- Should survive the model reset
- But frontend rollout should follow the new device ledger semantics, not the old exploratory assumptions

### APIs

- List: `GET /api/v1/device-types`
- Detail: none
- Create: `POST /api/v1/device-types`
- Update: `PATCH /api/v1/device-types/:id`
- Delete: none

### Current create payload

```json
{
  "typeCode": "DT-S08-NEW",
  "typeName": "Flow Collector",
  "family": "meter",
  "capabilityJson": {
    "protocol": "tcp-json-v1",
    "metrics": ["flow"]
  },
  "defaultConfigJson": {
    "idleTimeoutSeconds": 120
  }
}
```

### Current update payload

```json
{
  "typeName": "Flow Collector V2",
  "family": "meter",
  "capabilityJson": {
    "protocol": "tcp-json-v1",
    "metrics": ["flow", "runtime"]
  }
}
```

### Form rule

- `family` is controlled vocabulary. Do not let it drift into random free text.
- Device type is the right place for capability schema and default config, not the device list form.

## 6. Not ready as generic CRUD in this round

These objects should not be implemented as forms until a later task explicitly reopens them:

- projects
- generic assets
- asset tree editor
- asset relation editor
- generic asset-device binding editor
- generic device relation editor
- billing-packages
- well-runtime-policies
- users

## Frontend implementation rule

- Use current compatibility forms only where explicitly allowed by the next frontend task.
- Do not infer final domain semantics from current payload names.
- After submit, refetch the list. Current compatibility endpoints still return compact or placeholder responses.
