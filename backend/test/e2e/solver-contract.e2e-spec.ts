import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { closeTestApp, createTestApp } from '../support/test-app';
import { SOLVER_CONTRACT_VERSION } from '../../src/modules/solver/solver.dto';

describe('solver contract (COD-2026-03-26-013 skeleton, COD-2026-03-27-035 readModel)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('exposes POST ops/solver preview/plan/explain/simulate with stable envelope', async () => {
    const preview = await request(app.getHttpServer())
      .post('/api/v1/ops/solver/preview')
      .send({ project_id: '00000000-0000-0000-0000-000000000801' })
      .expect(200);

    expect(preview.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);
    expect(preview.body.status).toBe('accepted');
    expect(preview.body.readModel).toMatchObject({
      networkModelVersion: null,
      pumpValveTopology: null
    });
    expect(preview.body.result).toMatchObject({ feasible: true });

    const plan = await request(app.getHttpServer()).post('/api/v1/ops/solver/plan').send({}).expect(200);
    expect(plan.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);
    expect(plan.body.readModel).toBeDefined();
    expect(plan.body.result).toHaveProperty('steps');

    const explain = await request(app.getHttpServer()).post('/api/v1/ops/solver/explain').send({}).expect(200);
    expect(explain.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);

    const simulate = await request(app.getHttpServer()).post('/api/v1/ops/solver/simulate').send({}).expect(200);
    expect(simulate.body.contractVersion).toBe(SOLVER_CONTRACT_VERSION);
    expect(simulate.body.result).toHaveProperty('timeline');
  });
});
