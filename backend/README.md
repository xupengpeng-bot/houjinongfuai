# Backend Phase 1 Baseline

This folder is now a runnable minimum NestJS baseline for Phase 1 only.

## Scope Freeze

Included:

- auth / iam
- region
- device-type
- device-ledger
- irrigation-assets: well / pump / valve
- billing
- policy
- topology
- runtime: `start-check`, `create-session`, `stop-session`
- order
- alarm
- work-order
- uat
- ai-conversation: query, handoff, work-order submit only
- health

Excluded:

- fertigation and water-fertilizer orchestration
- weather, map linkage, and advanced triggers
- WeChat / Feishu / multi-channel AI
- Phase 2 / 3 features

## Core Constraints

- Backend is the only source of truth for runtime, billing, safety, and concurrency decisions.
- Frontends must not derive rules locally.
- AI must not control devices directly.
- Runtime decisions are exposed through the `RuntimeDecisionContract` response shape.

## Local Startup

1. Enter the backend directory:

```powershell
cd backend
```

2. Create a local env file:

```powershell
Copy-Item .env.example .env
```

3. Install dependencies:

```powershell
npm install
```

4. Start PostgreSQL:

```powershell
npm run db:up
```

5. Apply migrations:

```powershell
npm run db:migrate
```

6. Run the app in dev mode:

```powershell
npm run start:dev
```

7. Check health:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/api/v1/health -UseBasicParsing
```

## Verified In This Workspace

- `npm install`
- `npm run db:migrate:reset`
- `npm run build`
- `npm run start:dev`
- `GET /api/v1/health`

Database verification also confirmed that Phase 1 core tables exist, including:

- `runtime_session`
- `irrigation_order`
- `ai_conversation`

## Files Added For This Baseline

- Runtime app entry: `src/main.ts`
- Root module wiring: `src/app.module.ts`
- Health endpoint: `src/modules/health/health.module.ts`
- Common response contract: `src/common/http/api-response.ts`
- Runtime decision contract: `src/common/contracts/runtime-decision.ts`
- Docker PostgreSQL: `docker-compose.yml`
- Migration runner: `scripts/migrate.ps1`
- Startup checker: `scripts/check-start.ps1`
- OpenAPI freeze file: `openapi.v1.yaml`
- SQL migrations: `sql/migrations/*.sql`

## API Freeze

The frozen V1 OpenAPI draft is here:

- `openapi.v1.yaml`

It intentionally documents only the approved V1 surface and keeps these rules explicit:

- backend-only runtime and billing decisions
- no frontend rule derivation
- no AI device control

## Interface Inventory

- `GET /health`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/menus`
- `GET /system/users`
- `POST /system/users`
- `PATCH /system/users/{id}`
- `POST /system/users/{id}/roles`
- `GET /system/roles`
- `GET /system/permissions`
- `GET /regions/tree`
- `GET /regions`
- `POST /regions`
- `PATCH /regions/{id}`
- `GET /device-types`
- `POST /device-types`
- `PATCH /device-types/{id}`
- `GET /devices`
- `POST /devices`
- `GET /devices/{id}`
- `PATCH /devices/{id}`
- `GET /devices/{id}/telemetry`
- `GET /wells`
- `POST /wells`
- `GET /wells/{id}`
- `PATCH /wells/{id}`
- `GET /pumps`
- `POST /pumps`
- `GET /pumps/{id}`
- `PATCH /pumps/{id}`
- `GET /valves`
- `POST /valves`
- `GET /valves/{id}`
- `PATCH /valves/{id}`
- `GET /billing-packages`
- `POST /billing-packages`
- `PATCH /billing-packages/{id}`
- `GET /well-runtime-policies`
- `POST /well-runtime-policies`
- `PATCH /well-runtime-policies/{id}`
- `GET /well-runtime-policies/{id}/effective-preview`
- `GET /pump-valve-relations`
- `POST /pump-valve-relations`
- `PATCH /pump-valve-relations/{id}`
- `POST /u/runtime/start-check`
- `POST /u/runtime/sessions`
- `POST /u/runtime/sessions/{id}/stop`
- `GET /orders`
- `GET /orders/{id}`
- `GET /orders/{id}/pricing`
- `POST /orders/{id}/review`
- `GET /u/orders`
- `GET /alarms`
- `GET /alarms/{id}`
- `POST /alarms/{id}/acknowledge`
- `POST /alarms/{id}/resolve`
- `GET /work-orders`
- `POST /work-orders`
- `GET /work-orders/{id}`
- `POST /work-orders/{id}/assign`
- `POST /work-orders/{id}/accept`
- `POST /work-orders/{id}/process`
- `GET /m/my/todos`
- `GET /m/my/work-orders`
- `GET /uat/cases`
- `POST /uat/cases`
- `GET /uat/executions`
- `POST /uat/executions/{id}/pass`
- `POST /uat/executions/{id}/block`
- `POST /u/ai/conversations`
- `GET /u/ai/conversations/{id}`
- `GET /u/ai/conversations/{id}/messages`
- `POST /u/ai/conversations/{id}/messages`
- `POST /u/ai/conversations/{id}/handoff`
- `POST /u/ai/conversations/{id}/work-orders`
- `GET /u/help/faqs`

## Not Completed Yet

- No real database connection is wired into Nest providers yet. Migrations run successfully through Docker, but repositories are still placeholders.
- No ORM entities or repository implementations yet.
- No auth guard, JWT strategy, or permission enforcement yet.
- No request validation pipes or DTO class validation yet.
- No integration tests or e2e tests yet.
- Most controller responses are placeholders that reflect the frozen contract, not completed domain logic.

## Suggested Next Task Sheet

Recommended next ticket:

`Codex-03A: Runtime + Policy + Order domain implementation`

Target:

- implement repository layer for `region`, `device`, `well_runtime_policy`, `pump_valve_relation`, `runtime_session`, `irrigation_order`
- implement `EffectivePolicyResolver`
- implement `RuntimeDecisionService` with real deny/allow reasons
- implement order creation from runtime session end
- keep API surface frozen; only replace placeholder logic with real domain behavior
