import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { closeTestApp, createTestApp } from '../support/test-app';

describe('view contract smoke', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function expectKeys(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      expect(record).toHaveProperty(key);
    }
  }

  it('keeps farmer-facing payloads page-safe under current seed', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/start-check')
      .send({
        targetType: 'valve',
        targetId: '00000000-0000-0000-0000-000000000701',
        sceneCode: 'farmer_scan_start'
      })
      .expect(200);

    expect(start.body.code).toBe('OK');
    expectKeys(start.body.data, ['decisionId', 'result', 'blockingReasons', 'availableActions', 'pricePreview']);

    const create = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/sessions')
      .send({ decisionId: start.body.data.decisionId })
      .expect(200);

    const currentSession = await request(app.getHttpServer()).get('/api/v1/farmer/session/active').expect(200);
    expect(currentSession.body.code).toBe('OK');
    expectKeys(currentSession.body.data, [
      'id',
      'well_name',
      'status',
      'usage',
      'unit',
      'duration_minutes',
      'cost',
      'billing_package',
      'unit_price'
    ]);

    const stop = await request(app.getHttpServer())
      .post(`/api/v1/u/runtime/sessions/${create.body.data.sessionId}/stop`)
      .send({})
      .expect(200);
    expect(stop.body.code).toBe('OK');

    const history = await request(app.getHttpServer()).get('/api/v1/u/orders').expect(200);
    expect(history.body.code).toBe('OK');
    expect(history.body.data.items.length).toBeGreaterThan(0);
    expectKeys(history.body.data.items[0], [
      'id',
      'user',
      'well',
      'billing',
      'start_time',
      'end_time',
      'usage',
      'unit',
      'amount',
      'status'
    ]);
  });

  it('keeps ops list payloads page-safe under current seed', async () => {
    const devices = await request(app.getHttpServer()).get('/api/v1/devices').expect(200);
    expectKeys(devices.body.data.items[0], ['id', 'sn', 'name', 'type', 'area', 'well', 'status', 'last_report']);

    const wells = await request(app.getHttpServer()).get('/api/v1/wells').expect(200);
    expectKeys(wells.body.data.items[0], [
      'id',
      'name',
      'area',
      'depth',
      'pump_model',
      'daily_usage',
      'monthly_usage',
      'status'
    ]);

    const relations = await request(app.getHttpServer()).get('/api/v1/pump-valve-relations').expect(200);
    expectKeys(relations.body.data.items[0], [
      'id',
      'well',
      'pump',
      'valve',
      'sequence',
      'valve_delay',
      'pump_delay',
      'status'
    ]);

    const alerts = await request(app.getHttpServer()).get('/api/v1/alerts').expect(200);
    expectKeys(alerts.body.data.items[0], ['id', 'device', 'type', 'level', 'area', 'time', 'desc', 'status']);

    const workOrders = await request(app.getHttpServer()).get('/api/v1/work-orders').expect(200);
    expectKeys(workOrders.body.data.items[0], [
      'id',
      'title',
      'type',
      'alert',
      'area',
      'well',
      'assignee',
      'priority',
      'status',
      'created',
      'deadline'
    ]);

    const uatCases = await request(app.getHttpServer()).get('/api/v1/uat/cases').expect(200);
    expectKeys(uatCases.body.data.items[0], ['id', 'module', 'scenario', 'steps', 'passed', 'status', 'tester', 'date']);

    const users = await request(app.getHttpServer()).get('/api/v1/system/users').expect(200);
    expectKeys(users.body.data.items[0], ['id', 'name', 'username', 'role', 'area', 'phone', 'status']);

    const sessions = await request(app.getHttpServer()).get('/api/v1/run-sessions').expect(200);
    expectKeys(sessions.body.data.items[0], ['id', 'well', 'user', 'start_time', 'flow', 'duration', 'status']);

    const orders = await request(app.getHttpServer()).get('/api/v1/orders').expect(200);
    expectKeys(orders.body.data.items[0], [
      'id',
      'user',
      'phone',
      'well',
      'billing',
      'start_time',
      'end_time',
      'usage',
      'unit',
      'amount',
      'status'
    ]);

    const dashboard = await request(app.getHttpServer()).get('/api/v1/dashboard/stats').expect(200);
    expectKeys(dashboard.body.data, [
      'total_wells',
      'running_wells',
      'total_devices',
      'online_devices',
      'today_orders',
      'today_usage',
      'today_revenue',
      'pending_alerts',
      'open_work_orders',
      'monthly_usage',
      'monthly_revenue',
      'device_online_rate'
    ]);
  });

  it('COD-2026-03-27-013: ops auto-scheduling + cost-finance payload shape', async () => {
    const as = await request(app.getHttpServer()).get('/api/v1/ops/auto-scheduling').expect(200);
    const asd = (as.body as { data?: Record<string, unknown> }).data ?? as.body;
    expectKeys(asd, [
      'today_dispatch_count',
      'today_success_count',
      'today_failed_count',
      'today_pending_count',
      'recent_dispatches',
      'recent_insights'
    ]);

    const cf = await request(app.getHttpServer()).get('/api/v1/ops/cost-finance').expect(200);
    const cfd = (cf.body as { data?: Record<string, unknown> }).data ?? cf.body;
    expectKeys(cfd, [
      'period',
      'today_water_m3',
      'today_energy_kwh',
      'today_cost_yuan',
      'period_water_m3',
      'period_energy_kwh',
      'period_cost_yuan',
      'project_block_costs'
    ]);
  });
});
