# Main Codex Bootstrap

Status: active
Audience: PM, main Codex on a new machine
Purpose: provide one single startup file for the primary Codex thread when the machine has no local repos yet and must bootstrap from Git first, then from dispatch state.

## When to use this file

Use this file when:

- the machine is new
- local workspace paths differ from the old machine
- no local repository can be assumed to exist yet
- the PM wants to start from one main Codex only

Do not start by scanning historical task files.

## Core idea

The main Codex is the only thread the PM needs to start manually.

The main Codex starts as:

1. `delivery_orchestrator`
2. `requirements_engineer`

Only after requirements are understood and ready should the main Codex split work into downstream execution roles such as:

- `software_engineer`
- `uat_engineer`
- `marketing_strategy_engineer`
- `development_system_engineer`
- `embedded_engineer`
- `hardware_engineer`

## Language rule

The bootstrap prompt may be written in English for encoding stability, but that does not mean the main Codex should speak English to the PM.

User-facing rule:

- all PM-facing explanations, summaries, confirmations, and progress reports must default to Simplified Chinese
- English may be used only for literal code, commands, file names, field names, API names, and external product names
- if the PM explicitly asks for bilingual or English output, follow that instruction for that turn

This keeps the bootstrap text stable while keeping collaboration readable for the PM.

## Required Git repositories

The new machine must bootstrap from Git first.

Known remotes:

- backend repository:
  - `https://github.com/xupengpeng-bot/houjinongfuai.git`
  - local folder name: `houjinongfuai-working`
- embedded repository:
  - `https://github.com/xupengpeng-bot/hartware.git`
  - local folder name: `hartware`
- frontend repository:
  - `https://github.com/xupengpeng-bot/git-connect-9d2f5334.git`
  - local folder name: `lovable-working`
- optional sidecar repository (archived for the default workspace layout; do not assume it exists under `WORKSPACE_ROOT`):
  - `https://github.com/xupengpeng-bot/waterflow-control.git`
  - historical local folder name: `waterflow-control` (removed from `houjinongfuAI-Cursor` root in 2026-04-16; prototypes live in `lovable-working/src/features/waterflow/`)

## Workspace rule

Do not assume the old machine path exists.

The new machine may choose any short Windows-friendly root, for example:

```powershell
$env:WORKSPACE_ROOT = 'D:\work\zhinengti'
```

Then derive:

- `BUSINESS_REPO_ROOT = <WORKSPACE_ROOT>\houjinongfuai-working`
- `EMBEDDED_REPO_ROOT = <WORKSPACE_ROOT>\hartware`
- `PROJECT_DEV_ROOT = <EMBEDDED_REPO_ROOT>\projects\houjinongfuai`
- `FRONTEND_REPO_ROOT = <WORKSPACE_ROOT>\lovable-working`

## Startup order

The main Codex must follow this order:

1. choose `WORKSPACE_ROOT`
2. clone missing Git repositories
3. sync them to the active workspace branches
4. run workspace preflight from `PROJECT_DEV_ROOT`
5. read dispatch bootstrap when DB-backed dispatch is enabled
6. then enter the role-specific read chain

## Bootstrap commands

### 1. Create local workspace

```powershell
$env:WORKSPACE_ROOT = 'D:\work\zhinengti'
New-Item -ItemType Directory -Force -Path $env:WORKSPACE_ROOT | Out-Null
Set-Location $env:WORKSPACE_ROOT
```

### 2. Clone required repositories

```powershell
git clone https://github.com/xupengpeng-bot/houjinongfuai.git houjinongfuai-working
git clone https://github.com/xupengpeng-bot/hartware.git
git clone https://github.com/xupengpeng-bot/git-connect-9d2f5334.git lovable-working
```

If you still need the standalone sidecar for archaeology, clone it outside the default three-repo layout (see `docs/附属项目-waterflow-control.md`).

### 3. Sync to the active workspace branches

```powershell
git -C "$env:WORKSPACE_ROOT\houjinongfuai-working" fetch --all --prune
git -C "$env:WORKSPACE_ROOT\houjinongfuai-working" checkout main
git -C "$env:WORKSPACE_ROOT\houjinongfuai-working" pull --ff-only origin main

git -C "$env:WORKSPACE_ROOT\hartware" fetch --all --prune
git -C "$env:WORKSPACE_ROOT\hartware" checkout codex/init-stable-20260409
git -C "$env:WORKSPACE_ROOT\hartware" pull --ff-only origin codex/init-stable-20260409
```

If the frontend repo exists:

```powershell
git -C "$env:WORKSPACE_ROOT\lovable-working" fetch --all --prune
git -C "$env:WORKSPACE_ROOT\lovable-working" checkout main
git -C "$env:WORKSPACE_ROOT\lovable-working" pull --ff-only origin main
```

### 4. Run preflight

```powershell
Set-Location "$env:WORKSPACE_ROOT\hartware\projects\houjinongfuai"
.\tools\preflight.ps1 -BusinessRoot "$env:WORKSPACE_ROOT\houjinongfuai-working" -FrontendRoot "$env:WORKSPACE_ROOT\lovable-working"
```

### 5. Read dispatch bootstrap when enabled

```powershell
Set-Location "$env:WORKSPACE_ROOT\houjinongfuai-working\backend"
python .\scripts\dispatch_bootstrap_fetch.py --team software_engineer
```

If dispatch DB is not enabled yet, continue with file-based bootstrap from `<PROJECT_DEV_ROOT>`.

## Live read chain after bootstrap

After Git bootstrap completes, the main Codex must read in this order:

1. `<PROJECT_DEV_ROOT>\docs\codex\START-HERE.md`
2. `<BUSINESS_REPO_ROOT>\AGENTS.md`
3. `<PROJECT_DEV_ROOT>\PROJECT-CONFIG-REGISTRY.md`
4. `<PROJECT_DEV_ROOT>\docs\codex\CURRENT.md`
5. `<PROJECT_DEV_ROOT>\docs\codex\ROLE-INIT-README.md`
6. `<PROJECT_DEV_ROOT>\docs\governance\requirements-engineering-standard.md`
7. `<PROJECT_DEV_ROOT>\docs\governance\requirement-change-impact-standard.md`
8. `<PROJECT_DEV_ROOT>\docs\governance\requirement-confirmation-loop.md`
9. `<PROJECT_DEV_ROOT>\docs\governance\definition-of-ready.md`
10. `<PROJECT_DEV_ROOT>\docs\governance\end-to-end-delivery-model.md`
11. `<PROJECT_DEV_ROOT>\docs\codex\DOMAIN-NAVIGATION.md`
12. `<PROJECT_DEV_ROOT>\docs\codex\RESULT.md`

Do not read historical task sheets unless `CURRENT.md`, PM, or a requirement explicitly points there.

## Required project understanding depth

Not every role needs the same project context.

Use this rule:

### Main Codex

The main Codex must understand the overall project at a working level before splitting tasks. It should read enough to understand:

- business boundaries from `AGENTS.md`
- the live dispatch state from `CURRENT.md`
- requirement, change-impact, and ready-gate rules
- how to route into the correct domain

The main Codex should know the overall shape of the project, not just one isolated task card.

### Downstream execution roles

Execution roles do not need to read the whole project history.

They need:

- the active task or requirement slice they own
- hard boundaries from `AGENTS.md`
- the minimum matching role-init instructions
- relevant config, verification, and handoff rules

They should not scan old historical tasks or unrelated domains by default.

### Historical knowledge

Historical files are reference material, not the primary truth source.

Use them only when:

- `CURRENT.md` points there
- PM explicitly points there
- the active task requires prior implementation context

The default rule is:

- main Codex understands the project globally
- execution roles understand their task locally

## Main Codex execution rule

The main Codex must behave like this:

- if PM gives a fuzzy requirement:
  - first act as `requirements_engineer`
  - output a requirement understanding package
  - output scope, non-goals, acceptance, open questions, and recommended task split
  - if it is a requirement change, output global impact points before any execution
- if `CURRENT.md` already points to a ready executable task:
  - move into the matching execution role
- if `active task = none`:
  - do not invent execution work
  - only perform requirement analysis for newly given PM input
- if domain is unclear:
  - use `DOMAIN-NAVIGATION.md`
  - do not guess and do not scan history by default

## New-environment tool-path rule

On a new machine, the main Codex must not assume remembered embedded or hardware tool paths.

If work touches embedded or hardware lanes, ask PM to confirm actual tool paths for that machine before continuing, including when relevant:

- `arm-none-eabi-gcc`
- `openocd`
- `st-flash` or `STM32_Programmer_CLI`
- `stm32flash`
- serial tool path
- `J-Link` tools

## Suggested PM prompt for the main Codex

The PM can send the following to one main Codex thread:

```text
You are the primary Codex controller for this project on a new machine.

You start with two roles:
1. delivery_orchestrator
2. requirements_engineer

Do not start coding immediately. Complete Git bootstrap first, then move into requirement understanding or task execution.

Execution rules:
1. Use the current machine's WORKSPACE_ROOT. Do not assume the old machine path exists.
2. If local repositories do not exist yet, fetch them from:
   - houjinongfuai: https://github.com/xupengpeng-bot/houjinongfuai.git
   - hartware: https://github.com/xupengpeng-bot/hartware.git
   - lovable-working: https://github.com/xupengpeng-bot/git-connect-9d2f5334.git
3. Optional: only if you explicitly need the archived sidecar repo, also fetch https://github.com/xupengpeng-bot/waterflow-control.git (not part of the default workspace root set).
4. After Git sync completes, run preflight.
5. Then read files in the order defined by MAIN-CODEX-BOOTSTRAP.md.
6. If PM gives a fuzzy requirement, output a requirement understanding package first. Do not code yet.
7. If CURRENT.md already points to a ready task, enter the matching execution role.
8. If there is no active task, do not invent execution work.
9. All PM-facing responses should default to Simplified Chinese.

For each response, first report:
- stage
- interpreted request type
- owner role now
- requirement status
- next role
- blocked items
```

## Success condition

This file succeeds if a new-machine main Codex can:

1. discover the required Git remotes
2. bootstrap local repos from scratch
3. read the correct active chain
4. stop on missing task truth
5. ask PM for frontend remote or device tool paths only when really needed
6. translate fuzzy PM input into a confirmed requirement package before execution
