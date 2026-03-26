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

  it('COD-032: ops/project-overview includes legacy compat + aggregation fields', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/ops/project-overview').expect(200);
    const d = (res.body as { data?: Record<string, unknown> }).data ?? res.body;
    expect(d).toMatchObject({
      project_count: expect.any(Number),
      block_count: expect.any(Number),
      active_well_count: expect.any(Number),
      online_metering_point_count: expect.any(Number),
      running_session_count: expect.any(Number),
      open_alert_count: expect.any(Number),
      open_work_order_count: expect.any(Number),
      well_count: expect.any(Number),
      device_count: expect.any(Number),
      running_wells: expect.any(Number),
      today_usage_m3: expect.any(Number),
      today_revenue_yuan: expect.any(Number),
      pending_alerts: expect.any(Number)
    });
  });

  it('COD-032: ops/block-cockpit returns items and total', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/ops/block-cockpit').expect(200);
    const d = (res.body as { data?: { items?: unknown[]; total?: number } }).data ?? res.body;
    expect(Array.isArray(d.items)).toBe(true);
    expect(typeof d.total).toBe('number');
    expect(d.total).toBe(d.items?.length ?? 0);
  });

  it('COD-2026-03-27-002: ops/run-monitor, alert-center, history-replay aggregates', async () => {
    const rm = await request(app.getHttpServer()).get('/api/v1/ops/run-monitor').expect(200);
    const rmd = (rm.body as { data?: Record<string, unknown> }).data ?? rm.body;
    expect(rmd).toMatchObject({
      running_session_count: expect.any(Number),
      running_well_count: expect.any(Number),
      online_device_count: expect.any(Number),
      today_usage_m3: expect.any(Number)
    });
    expect(Array.isArray(rmd.recent_sessions)).toBe(true);

    const ac = await request(app.getHttpServer()).get('/api/v1/ops/alert-center').expect(200);
    const acd = (ac.body as { data?: Record<string, unknown> }).data ?? ac.body;
    expect(acd).toMatchObject({
      open_count: expect.any(Number),
      processing_count: expect.any(Number),
      closed_count: expect.any(Number),
      severity_counts: expect.objectContaining({
        low: expect.any(Number),
        medium: expect.any(Number),
        high: expect.any(Number),
        critical: expect.any(Number)
      })
    });
    expect(Array.isArray(acd.recent_alerts)).toBe(true);

    const hr = await request(app.getHttpServer()).get('/api/v1/ops/history-replay').expect(200);
    const hrd = (hr.body as { data?: Record<string, unknown> }).data ?? hr.body;
    expect(hrd.time_range).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    expect(hrd.filter).toMatchObject({ project_id: null, block_id: null });
    expect(typeof hrd.total).toBe('number');
    expect(Array.isArray(hrd.sessions)).toBe(true);
  });
});
