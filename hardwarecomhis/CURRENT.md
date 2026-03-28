# Hardware Current

Status: paused
Audience: 硬件工程师
Purpose: this is the only live execution entry for hardware work. When PM or the user says only "execute", read this file first.

## Current state

- current wave status
  - `paused`
- reason
  - hardware work is deferred until the device integration wave starts
- prepared task
  - `HW-0001` communication and power interface baseline

## Allowed working area

- `.\hardwarecomhis`
- dedicated hardware repo or package directory only after PM explicitly points to it

Do not modify backend, frontend, or embedded directories unless PM changes this file.

## Read order once reopened

1. `hardwarecomhis/README.md`
2. `docs/governance/file-only-command-protocol.md`
3. `docs/governance/delivery-workflow.md`
4. `hardwarecomhis/HW-0001-通信与供电接口基线.md`
5. `hardwarecomhis/context/HW-0001-context.md`
6. `hardwarecomhis/fixtures/HW-0001/*`

## Execute now

- Do not execute now.
- Wait until PM changes this file from `paused` to `active`.

## Result writeback

When reopened and executed, update `hardwarecomhis/RESULT.md`.
