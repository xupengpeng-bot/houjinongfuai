import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DatabaseService } from '../../src/common/db/database.service';
import { SOLVER_CONTRACT_VERSION } from '../../src/modules/solver/solver.dto';
import { closeTestApp, createTestApp } from '../support/test-app';

const PUBLISHED_NETWORK_VERSION = '00000000-0000-0000-0000-000000000a11';
const DEMO_NETWORK_MODEL = '00000000-0000-0000-0000-000000000a10';
const PHASE1_TENANT = '00000000-0000-0000-0000-000000000001';
const DEMO_PROJECT = '00000000-0000-0000-0000-000000000801';

describe('solver contract (published network_model_version required)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
    const db = bootstrap.app.get(DatabaseService);
    await ensurePublishedNetworkGraph(db);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('rejects preview/plan without published network_model_version_id', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ops/solver/preview')
      .send({ project_id: '00000000-0000-0000-0000-000000000801' })
      .expect(400);

    await request(app.getHttpServer()).post('/api/v1/ops/solver/plan').send({}).expect(400);
  });

  it('exposes POST ops/solver preview/plan with published graph readModel; explain/simulate unchanged', async () => {
    const preview = await request(app.getHttpServer())
      .post('/api/v1/ops/solver/preview')
      .send({ network_model_version_id: PUBLISHED_NETWORK_VERSION, constraints: { objective: 'balanced' } })
      .expect(200);

    expect(preview.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);
    expect(preview.body.status).toBe('accepted');
    expect(preview.body.readModel.networkModelVersion.id).toBe(PUBLISHED_NETWORK_VERSION);
    expect(preview.body.readModel.networkModelVersion.isPublished).toBe(true);
    expect(preview.body.readModel.networkGraphSnapshot.source).toBe('database');
    expect(preview.body.readModel.networkGraphSnapshot.nodeCount).toBeGreaterThanOrEqual(0);
    expect(preview.body.readModel.networkGraphSnapshot.pipeCount).toBeGreaterThanOrEqual(0);
    expect(preview.body.readModel.pumpValveTopology).toBeNull();
    expect(preview.body.result).toMatchObject({ feasible: true });
    expect(preview.body.result.summary.selected_objective).toBe('balanced');
    expect(Array.isArray(preview.body.result.explanations)).toBe(true);
    expect(Array.isArray(preview.body.result.plans)).toBe(true);

    const plan = await request(app.getHttpServer())
      .post('/api/v1/ops/solver/plan')
      .send({ network_model_version_id: PUBLISHED_NETWORK_VERSION, objective: 'stability_first' })
      .expect(200);
    expect(plan.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);
    expect(plan.body.readModel.networkGraphSnapshot).toBeDefined();
    expect(plan.body.result).toHaveProperty('steps');
    expect(plan.body.result.objective).toBe('stability_first');
    expect(Array.isArray(plan.body.result.candidatePlans)).toBe(true);
    expect(Array.isArray(plan.body.result.explanations)).toBe(true);

    const explain = await request(app.getHttpServer())
      .post('/api/v1/ops/solver/explain')
      .send({ context: { objective: 'throughput_first' } })
      .expect(200);
    expect(explain.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);
    expect(explain.body.result.objective).toBe('throughput_first');
    expect(Array.isArray(explain.body.result.available_objectives)).toBe(true);

    const simulate = await request(app.getHttpServer()).post('/api/v1/ops/solver/simulate').send({}).expect(200);
    expect(simulate.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);
    expect(simulate.body.result).toHaveProperty('timeline');

    const published = await request(app.getHttpServer())
      .get(`/api/v1/ops/network-models/${DEMO_NETWORK_MODEL}/published-version`)
      .expect(200);
    expect(published.body.data.id).toBe(PUBLISHED_NETWORK_VERSION);
  });
});

/** Minimal persisted graph so preview/plan always bind to a published `network_model_version` row. */
async function ensurePublishedNetworkGraph(db: DatabaseService) {
  await db.query(
    `
    insert into network_model (id, tenant_id, project_id, model_name, source_type, status)
    values ($1, $2, $3, 'e2e hydraulic skeleton', 'manual', 'draft')
    on conflict (id) do nothing
    `,
    [DEMO_NETWORK_MODEL, PHASE1_TENANT, DEMO_PROJECT]
  );
  await db.query(
    `update network_model_version set is_published = false, published_at = null where network_model_id = $1`,
    [DEMO_NETWORK_MODEL]
  );
  await db.query(
    `
    insert into network_model_version (id, network_model_id, version_no, is_published, source_file_ref, published_at)
    values ($1, $2, 1, true, null, now())
    on conflict (id) do update set
      is_published = true,
      published_at = coalesce(excluded.published_at, network_model_version.published_at, now()),
      network_model_id = excluded.network_model_id,
      version_no = excluded.version_no
    `,
    [PUBLISHED_NETWORK_VERSION, DEMO_NETWORK_MODEL]
  );
}
