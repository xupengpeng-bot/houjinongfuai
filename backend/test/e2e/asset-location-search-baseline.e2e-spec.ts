import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { closeTestApp, createTestApp } from '../support/test-app';

describe('asset location search backend baseline', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('returns project-scoped region_reference candidates', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/assets/location-search')
      .query({
        project_id: '00000000-0000-0000-0000-000000000801',
        q: 'Puju'
      })
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('scope');
    expect(res.body.scope.region_code).toBe('610431');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toHaveProperty('manual_region_id');
    expect(res.body.items[0]).toHaveProperty('manual_address_text');
    expect(res.body.items.every((item: { manual_region_id: string }) => item.manual_region_id.startsWith('610431'))).toBe(true);
  });

  it('rejects too-short fuzzy queries', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/assets/location-search')
      .query({
        project_id: '00000000-0000-0000-0000-000000000801',
        q: 'P'
      })
      .expect(400);

    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });
});
