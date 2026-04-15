# Device Gateway Sidecar Bridge Contract v1

## 1. Purpose

This document defines the platform-side sidecar bridge contract used by:

- HTTP bridge
- serial bridge
- other bridge adapters that are not the MCU TCP mainline

Its goal is to prevent confusion between:

- platform delivery/audit queue semantics
- MCU realtime control semantics

## 2. Non-Goal

This document is not the MCU TCP protocol contract.

MCU mainline TCP still uses:

- `4-byte big-endian length + UTF-8 JSON`
- short envelope `v/t/i/m/s/c/r/p`
- message types `RG/HB/SS/ER/QR/QS/EX/SC/AK/NK`

Bridge endpoints such as `bridge/heartbeat` and `pending-commands` are sidecar transport capabilities only.

## 3. Endpoints

Current sidecar bridge endpoints:

- `POST /api/v1/ops/device-gateway/bridge/connect`
- `POST /api/v1/ops/device-gateway/bridge/heartbeat`
- `POST /api/v1/ops/device-gateway/bridge/disconnect`
- `GET /api/v1/ops/device-gateway/pending-commands`
- `POST /api/v1/ops/device-gateway/runtime-events`

## 4. Hard Boundary

### 4.1 Platform queue is not device queue

The platform may keep:

- `device_command`
- `retry_pending`
- `dead_letter`
- delivery retry metadata

These are platform truth and sidecar delivery states only.

They do not mean:

- the MCU may cache control commands
- the MCU may keep a delayed execution queue
- the MCU may replay historical control after reconnect or reboot

### 4.2 Control semantics remain realtime

For realtime control commands:

- the device must not keep a control queue
- the device must not cache pending control actions locally
- the current control action must be cleared when it completes, fails, is rejected, or times out
- delayed resend is a platform-side delivery decision, not a device-side queue semantics

### 4.3 Heartbeat piggyback exists only in sidecar mode

`bridge/heartbeat` may optionally piggyback platform pending commands.

This is allowed only for sidecar bridge transport.

Default behavior should be no piggyback delivery.

Only explicit `dispatch_pending_commands=true` should enable pending command delivery on heartbeat.

It must never be described as MCU TCP heartbeat semantics.

## 5. Response Metadata

To make the boundary explicit, sidecar bridge responses should expose these semantics:

- `transport_contract = sidecar_bridge_v1`
- `delivery_contract = platform_queue_only`
- `device_execution_queue = false`
- `queue_mode = backend_command_queue`

These fields are declarative. They exist to stop integrators from misreading bridge delivery as device queue behavior.

## 6. Recommended Flow

### 6.1 Sidecar bridge

1. `bridge/connect`
2. `bridge/heartbeat`
3. optional pending command delivery
4. adapter writes command to downstream serial/http bridge target
5. adapter reports result through `runtime-events`
6. `bridge/disconnect`

### 6.2 MCU TCP mainline

1. TCP connect
2. `RG`
3. lease-based `HB`
4. independent `SS/ER/QS`
5. downstream `SC/QR/EX`
6. immediate `AK/NK`

No `pending-commands` queue semantics are implied by the MCU TCP mainline.

## 7. OTA Exception

OTA may persist upgrade transaction state such as:

- manifest
- download offset
- verification state
- boot control

This is still not a generic control queue.

The platform should only mark OTA success after `boot_confirmed`.
