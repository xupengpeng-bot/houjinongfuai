# Embedded Controller Firmware Development Spec v1

## 1. Scope

This document is the firmware-facing implementation spec for embedded controllers that connect to the backend over TCP.

Its purpose is not to debate protocol shape. Its purpose is to make implementation direction unambiguous.

## 2. Non-Negotiable Rule

Backend and embedded firmware must use the compact short protocol only.

- Envelope keys: `v/t/i/m/s/c/r/p`
- Message codes: `RG/HB/SS/ER/QR/QS/EX/SC/AK/NK`
- Business codes: `qcs/qwf/qem/spu/tpu/ovl/cvl/pas/res/ppu/upg/...`

Do not implement these as the firmware wire format:

- `protocol/type/imei/msg_id/seq/payload`
- `query_code/action_code/module_code` as top-level TCP fields
- `tcp-json-v1` as a new embedded mainline protocol
- dual-format or compatibility-first transport logic

If the platform internally stores long semantic names, that is a backend normalization concern only.

## 3. Transport

- TCP long connection
- Frame format: `4-byte big-endian length + UTF-8 JSON`
- JSON encoding: UTF-8
- The first packet after a successful connection must be `RG`

## 4. Required Message Flow

1. Bring up 4G/network.
2. Establish TCP connection.
3. Send `RG`.
4. Enter `HB` loop.
5. Send `SS` independently when runtime state changes or periodic snapshots are due.
6. Accept platform downstream `SC` / `QR` / `EX`.
7. Reply with `AK` or `NK` immediately after command acceptance decision.

## 4.1 Control Action Hard Rule

Control actions are realtime only.

- The device must not keep a control queue.
- The device must not cache pending control actions for later execution.
- Only one side-effect control action may be in-flight at a time.
- When the current control action finishes, fails, is rejected, or times out, its local execution context must be cleared immediately.
- The device must not auto-replay historical control actions after reconnect or reboot.
- OTA is the only exception that may persist upgrade transaction state, but OTA manifest/state persistence is not a generic control queue.

## 5. Required Runtime Modules

Keep the first implementation lightweight and direct. Recommended minimum split:

- `transport`
- `protocol`
- `runtime_state`
- `config_store`
- `telemetry`
- `safety_flow`

Avoid building a generic workflow DSL or oversized framework in the first phase.

## 6. Firmware Responsibilities

- Maintain device identity and current config version.
- Persist current config and recover it after reboot.
- Report heartbeat and state snapshot using short protocol fields.
- Execute downstream actions using existing business semantics after short-code parsing.
- Implement local protection and fail-safe behavior.
- Never mix modem AT text into business payloads.

## 7. Protocol Layer Requirements

The protocol layer must handle:

- compact envelope encode/decode
- message dispatch by `t`
- query code dispatch by `qc`
- action code dispatch by `ac`
- sync-config persistence after `SC`
- immediate `AK/NK` generation

Suggested source layout:

```text
protocol/
  proto_envelope.c
  proto_envelope.h
  proto_codec_json.c
  proto_codec_json.h
  proto_dispatch.c
  proto_dispatch.h
  proto_register.c
  proto_state_snapshot.c
  proto_event_report.c
  proto_query.c
  proto_execute_action.c
  proto_sync_config.c
```

## 8. Minimal Data Model

Recommended minimum persistent state:

- controller identity
- active config
- current `config_version`
- current workflow/runtime state
- active session context if applicable
- counters needed for settlement or recovery

Recommended volatile state:

- signal/battery/solar sampling cache
- current pressure/flow/meter readings
- short-lived action timeout context

## 9. Query and Action Handling

- `QR` should return quickly and must not block the main loop for long peripheral reads.
- For pure memory-backed state, respond immediately.
- For peripheral-backed queries, use a bounded refresh and return `NK` on timeout.
- `EX` should parse short codes on the wire, then route to the existing internal module handler.

Examples:

- `qc=qcs` -> query common status
- `ac=spu` -> start pump
- `ac=ovl` -> open valve

## 10. Config Handling

On `SC`:

1. Parse short envelope.
2. Validate payload.
3. Validate module/resource consistency.
4. Persist config.
5. Switch active config pointer/version.
6. Reply with `AK`.

The config reply must include the effective config version.

## 11. Acceptance Checklist

Firmware is not considered ready unless all of these are true:

- First packet is `RG`.
- TCP traffic uses short envelope only.
- No long envelope fields are emitted on the wire.
- `SC` can be stored and acknowledged.
- `QR` returns stable responses.
- `EX` can reach real actuator/module logic.
- no device-side control queue or delayed control cache exists.
- reboot recovery does not silently resume stale execution.

## 12. References

- [embedded-controller-compact-protocol-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-protocol-v1.md)
- [embedded-controller-compact-dictionaries-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-compact-dictionaries-v1.md)
- [embedded-controller-4g-packet-rules-v1.md](/D:/Develop/houji/houjinongfuAI-Cursor/houjinongfuai-working/docs/protocol/embedded-controller/embedded-controller-4g-packet-rules-v1.md)
