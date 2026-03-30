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

- `docs/codex-dispatch/hardwarecomhis`
- dedicated hardware repo or package directory only after PM explicitly points to it

Do not modify backend, frontend, or embedded directories unless PM changes this file.

## Read order once reopened

1. `docs/codex-dispatch/hardwarecomhis/README.md`
2. `docs/governance/file-only-command-protocol.md`
3. `docs/governance/delivery-workflow.md`
4. `docs/codex-dispatch/hardwarecomhis/HW-0001-通信与供电接口基线.md`
5. `docs/codex-dispatch/hardwarecomhis/context/HW-0001-context.md`
6. `docs/codex-dispatch/hardwarecomhis/fixtures/HW-0001/*`

## Execute now

- Do not execute now.
- Wait until PM changes this file from `paused` to `active`.
- On a new machine or new bench environment, first ask PM / user to confirm the actual tool paths before flash, debug, or serial-interface work.
- Minimum confirmation set:
  - `openocd`
  - `st-flash` or `STM32_Programmer_CLI`
  - `J-Link` tools when SEGGER tooling is involved
  - serial-terminal tool path when UART observation is needed

## Result writeback

When reopened and executed, update `docs/codex-dispatch/hardwarecomhis/RESULT.md`.
