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

- `docs/codex-dispatch/embeddedcomhis`
- dedicated firmware repo only after PM explicitly points to it

Do not modify backend, frontend, or hardware directories unless PM changes this file.

## Read order once reopened

1. `docs/codex-dispatch/embeddedcomhis/README.md`
2. `docs/governance/file-only-command-protocol.md`
3. `docs/governance/delivery-workflow.md`
4. `docs/codex-dispatch/embeddedcomhis/EMB-0001-tcp-json-v1固件接入基线.md`
5. `docs/codex-dispatch/embeddedcomhis/context/EMB-0001-context.md`
6. `docs/codex-dispatch/embeddedcomhis/fixtures/EMB-0001/*`

## Execute now

- Do not execute now.
- Wait until PM changes this file from `paused` to `active`.
- On a new machine or new bench environment, first ask PM / user to confirm the actual tool paths before build, flash, debug, or serial work.
- Minimum confirmation set:
  - `arm-none-eabi-gcc`
  - `openocd`
  - `st-flash` or `STM32_Programmer_CLI`
  - `stm32flash` when serial flashing is needed
  - serial-terminal tool path when UART observation is needed

## Result writeback

When reopened and executed, update `docs/codex-dispatch/embeddedcomhis/RESULT.md`.
