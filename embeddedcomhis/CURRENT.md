# Embedded Current

Status: paused
Audience: 嵌入式工程师
Purpose: this is the only live execution entry for embedded work. When PM or the user says only "execute", read this file first.

## Current state

- current wave status
  - `paused`
- reason
  - embedded work is deferred until the device integration wave starts
- prepared task
  - `EMB-0001` tcp-json-v1 firmware baseline

## Allowed working area

- `.\embeddedcomhis`
- dedicated firmware repo only after PM explicitly points to it

Do not modify backend, frontend, or hardware directories unless PM changes this file.

## Read order once reopened

1. `embeddedcomhis/README.md`
2. `docs/governance/file-only-command-protocol.md`
3. `docs/governance/delivery-workflow.md`
4. `embeddedcomhis/EMB-0001-tcp-json-v1固件接入基线.md`
5. `embeddedcomhis/context/EMB-0001-context.md`
6. `embeddedcomhis/fixtures/EMB-0001/*`

## Execute now

- Do not execute now.
- Wait until PM changes this file from `paused` to `active`.

## Result writeback

When reopened and executed, update `embeddedcomhis/RESULT.md`.
