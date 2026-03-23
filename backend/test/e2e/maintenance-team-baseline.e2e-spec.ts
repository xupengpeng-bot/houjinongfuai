import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { closeTestApp, createTestApp } from '../support/test-app';

describe('maintenance-team backend baseline', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('exposes active maintenance team options', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/maintenance-teams/options').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('value');
    expect(res.body[0]).toHaveProperty('label');
  });

  it('returns project default team and asset effective team fields', async () => {
    const project = await request(app.getHttpServer()).get('/api/v1/projects/00000000-0000-0000-0000-000000000801').expect(200);
    expect(project.body).toHaveProperty('maintenance_team_id');
    expect(project.body).toHaveProperty('maintenance_team_name');
    expect(project.body.maintenance_team_id).toBe('00000000-0000-0000-0000-000000000701');

    const asset = await request(app.getHttpServer()).get('/api/v1/assets/00000000-0000-0000-0000-000000000911').expect(200);
    expect(asset.body).toHaveProperty('maintenance_team_id');
    expect(asset.body).toHaveProperty('project_maintenance_team_id');
    expect(asset.body).toHaveProperty('effective_maintenance_team_id');
    expect(asset.body).toHaveProperty('effective_maintenance_team_name');
    expect(asset.body.maintenance_team_id).toBe('00000000-0000-0000-0000-000000000702');
    expect(asset.body.project_maintenance_team_id).toBe('00000000-0000-0000-0000-000000000701');
    expect(asset.body.effective_maintenance_team_id).toBe('00000000-0000-0000-0000-000000000702');
  });
});
