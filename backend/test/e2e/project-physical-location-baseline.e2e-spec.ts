import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { closeTestApp, createTestApp } from '../support/test-app';

describe('project physical-location backend baseline', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('creates and updates a project with a separate physical-location administrative region code', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .send({
        project_name: 'Physical Location Demo Project',
        region_id: '00000000-0000-0000-0000-000000000203',
        manual_region_id: '610431001',
        status: 'draft',
        owner: 'County Water Bureau',
        contact_phone: '029-37219999',
        operator: 'Houji Operations Team',
        remarks: 'Created during focused backend baseline verification'
      })
      .expect(201);

    expect(createRes.body).toHaveProperty('region_id', '00000000-0000-0000-0000-000000000203');
    expect(createRes.body).toHaveProperty('manual_region_id', '610431001');
    expect(createRes.body.manual_region_name).toBeTruthy();
    expect(createRes.body.manual_region_full_path_name).toBeTruthy();

    const projectId = createRes.body.id as string;

    const detailRes = await request(app.getHttpServer()).get(`/api/v1/projects/${projectId}`).expect(200);
    expect(detailRes.body).toHaveProperty('manual_region_id', '610431001');
    expect(detailRes.body.manual_region_name).toBeTruthy();

    const optionsRes = await request(app.getHttpServer()).get('/api/v1/projects/options').expect(200);
    const createdOption = optionsRes.body.find((item: { value: string }) => item.value === projectId);
    expect(createdOption).toBeTruthy();
    expect(createdOption.manual_region_id).toBe('610431001');
    expect(createdOption.manual_region_full_path_name).toBeTruthy();

    const updateRes = await request(app.getHttpServer())
      .put(`/api/v1/projects/${projectId}`)
      .send({
        manual_region_id: '610431001001'
      })
      .expect(200);

    expect(updateRes.body).toHaveProperty('manual_region_id', '610431001001');
    expect(updateRes.body.manual_region_name).toBeTruthy();
    expect(updateRes.body.manual_region_full_path_name).toBeTruthy();
  });
});
