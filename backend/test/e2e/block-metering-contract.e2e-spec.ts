import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { closeTestApp, createTestApp } from '../support/test-app';

/** Set `E2E_WITH_DB=1` when Postgres has migrations + seed for blocks / metering points. */
const describeOrSkip = process.env.E2E_WITH_DB === '1' ? describe : describe.skip;

describeOrSkip('project block + metering point contract (COD-2026-03-26-015 / 018 / 021)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('exposes list and selector contracts', async () => {
    const blocks = await request(app.getHttpServer()).get('/api/v1/project-blocks').expect(200);
    expect(blocks.body).toHaveProperty('items');
    expect(blocks.body).toHaveProperty('total');

    const opts = await request(app.getHttpServer()).get('/api/v1/project-blocks/options').expect(200);
    expect(Array.isArray(opts.body)).toBe(true);

    const m = await request(app.getHttpServer()).get('/api/v1/metering-points').expect(200);
    expect(m.body).toHaveProperty('items');

    const fo = await request(app.getHttpServer()).get('/api/v1/metering-points/form-options').expect(200);
    expect(fo.body).toHaveProperty('projects');
    expect(fo.body).toHaveProperty('blocks');
    expect(fo.body).toHaveProperty('assets');
    expect(fo.body).toHaveProperty('devices');
    expect(fo.body).toHaveProperty('point_types');
    expect(fo.body).toHaveProperty('statuses');
    expect(Array.isArray(fo.body.point_types)).toBe(true);
    expect(Array.isArray(fo.body.statuses)).toBe(true);
    expect(fo.body.point_types[0]).toMatchObject({ value: expect.any(String), label: expect.any(String) });
    expect(fo.body.statuses[0]).toMatchObject({ value: expect.any(String), label: expect.any(String) });
  });

  it('LVB-4021 compat aliases on list payloads when rows exist', async () => {
    const blocks = await request(app.getHttpServer()).get('/api/v1/project-blocks').expect(200);
    if (blocks.body.items?.length > 0) {
      const b0 = blocks.body.items[0];
      expect(b0).toHaveProperty('area_size');
      expect(b0).toHaveProperty('area_hectare');
      expect(typeof b0.area_hectare === 'number' || b0.area_hectare === null).toBe(true);
    }

    const m = await request(app.getHttpServer()).get('/api/v1/metering-points').expect(200);
    if (m.body.items?.length > 0) {
      const p0 = m.body.items[0];
      expect(p0).toHaveProperty('metering_point_code');
      expect(p0).toHaveProperty('metering_type');
      expect(p0).toHaveProperty('point_code');
      expect(p0.point_code).toBe(p0.metering_point_code);
      expect(p0).toHaveProperty('point_type');
      expect(typeof p0.point_type).toBe('string');
    }
  });

  it('COD-021: project-blocks/options and form-options accept project_id and q', async () => {
    const optQ = await request(app.getHttpServer())
      .get('/api/v1/project-blocks/options')
      .query({ q: 'BLK' })
      .expect(200);
    expect(Array.isArray(optQ.body)).toBe(true);

    const fo = await request(app.getHttpServer())
      .get('/api/v1/metering-points/form-options')
      .query({ q: 'demo' })
      .expect(200);
    expect(fo.body).toHaveProperty('blocks');
    expect(fo.body).toHaveProperty('point_types');
  });
});
