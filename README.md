# Houjinongfuai Backend Workspace

This repository is the backend and formal business-document workspace inside `D:\Develop\houji\houjinongfuAI-Cursor`.

## Start Here

- repository rules: `AGENTS.md`
- backend runnable baseline: `backend/README.md`
- business document map: `docs/README.md`
- formal business requirements: `docs/系统说明/README.md`
- requirement entry: `docs/requirements/README.md`

## What Lives Here

- `backend/`
  - NestJS application, migrations, seeds, scripts, and OpenAPI baseline
- `docs/`
  - formal requirements, protocol, UAT, frontend integration, and document maps
- `qa/`
  - cross-team QA artifacts
- `产品说明书/`
  - source product documents kept for reference
- root helper scripts
  - `start-backend.ps1`
  - `start-frontend.ps1`
  - `start-web-test.ps1`

## Common Backend Flow

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run db:seed:reference
npm run start:dev
```

Health check:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/api/v1/health -UseBasicParsing
```

## Workspace Position

- current active backend working copy: `D:\Develop\houji\houjinongfuAI-Cursor\houjinongfuai-working`
- current active frontend working copy: `D:\Develop\houji\houjinongfuAI-Cursor\lovable-working`
- current embedded truth: `D:\Develop\houji\houjinongfuAI-Cursor\hartware`
- current project development-system folder: `D:\Develop\houji\houjinongfuAI-Cursor\hartware\projects\houjinongfuai`

## Truth Rules

- backend is the source of truth for runtime, billing, settlement, auth, audit, and device command routing
- frontend must consume backend contracts and must not invent business or protocol semantics locally
- embedded protocol changes that affect message types, codes, payloads, or response semantics must be synchronized with the public protocol documentation in the same round
