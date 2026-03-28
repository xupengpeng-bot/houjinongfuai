import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { SCENARIOS } from '../support/seed-scenarios';
import { closeTestApp, createTestApp } from '../support/test-app';

describe('uat smoke baseline', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('keeps seeded read surfaces populated for ops and uat pages', async () => {
    const devices = await request(app.getHttpServer()).get('/api/v1/devices').expect(200);
    expect(devices.body.code).toBe('OK');
    expect(devices.body.data.items.length).toBeGreaterThanOrEqual(20);

    const wells = await request(app.getHttpServer()).get('/api/v1/wells').expect(200);
    expect(wells.body.code).toBe('OK');
    expect(wells.body.data.items.length).toBeGreaterThanOrEqual(7);
    expect(wells.body.data.items.some((item: { name: string }) => String(item.name).includes('S01'))).toBe(true);

    const relations = await request(app.getHttpServer()).get('/api/v1/pump-valve-relations').expect(200);
    expect(relations.body.code).toBe('OK');
    expect(relations.body.data.items.some((item: { id: string }) => item.id === SCENARIOS.S08.objects.relationId)).toBe(true);

    const alerts = await request(app.getHttpServer()).get('/api/v1/alerts').expect(200);
    expect(alerts.body.code).toBe('OK');
    expect(new Set(alerts.body.data.items.map((item: { status: string }) => item.status))).toEqual(
      new Set(['pending', 'processing', 'resolved'])
    );

    const workOrders = await request(app.getHttpServer()).get('/api/v1/work-orders').expect(200);
    expect(workOrders.body.code).toBe('OK');
    expect(workOrders.body.data.items.length).toBeGreaterThanOrEqual(5);
    expect(
      ['created', 'assigned', 'in_progress', 'completed', 'closed'].every((status) =>
        workOrders.body.data.items.some((item: { status: string }) => item.status === status)
      )
    ).toBe(true);

    const uatCases = await request(app.getHttpServer()).get('/api/v1/uat/cases').expect(200);
    expect(uatCases.body.code).toBe('OK');
    expect(uatCases.body.data.items.length).toBeGreaterThanOrEqual(6);

    const users = await request(app.getHttpServer()).get('/api/v1/system/users').expect(200);
    expect(users.body.code).toBe('OK');
    expect(new Set(users.body.data.items.map((item: { role: string }) => item.role))).toEqual(
      new Set(['admin', 'operator', 'farmer'])
    );

    const sessions = await request(app.getHttpServer()).get('/api/v1/run-sessions').expect(200);
    expect(sessions.body.code).toBe('OK');
    expect(
      sessions.body.data.items.some(
        (item: { id: string; status: string }) => item.id === SCENARIOS.S06.objects.sessionId && item.status === 'running'
      )
    ).toBe(true);

    const orders = await request(app.getHttpServer()).get('/api/v1/orders').expect(200);
    expect(orders.body.code).toBe('OK');
    expect(
      orders.body.data.items.some(
        (item: { id: string; status: string }) => item.id === SCENARIOS.S06.objects.orderId && item.status === 'active'
      )
    ).toBe(true);

    const dashboard = await request(app.getHttpServer()).get('/api/v1/dashboard/stats').expect(200);
    expect(dashboard.body.code).toBe('OK');
    expect(Number(dashboard.body.data.total_wells)).toBeGreaterThanOrEqual(7);
    expect(Number(dashboard.body.data.total_devices)).toBeGreaterThanOrEqual(20);
  });

  it('keeps the farmer happy path usable for /u/scan /u/session /u/history smoke', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/start-check')
      .send({
        targetType: SCENARIOS.S01.defaultTargetType,
        targetId: SCENARIOS.S01.objects.valveId,
        sceneCode: SCENARIOS.S01.defaultSceneCode
      })
      .expect(200);

    expect(start.body.code).toBe('OK');
    expect(start.body.data.result).toBe('allow');

    const create = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/sessions')
      .send({ decisionId: start.body.data.decisionId })
      .expect(200);

    expect(create.body.code).toBe('OK');
    expect(create.body.data.status).toBe('running');

    const currentSession = await request(app.getHttpServer()).get('/api/v1/farmer/session/active').expect(200);
    expect(currentSession.body.code).toBe('OK');
    expect(currentSession.body.data).not.toBeNull();
    expect(currentSession.body.data.status).toBe('running');

    const stop = await request(app.getHttpServer())
      .post(`/api/v1/u/runtime/sessions/${create.body.data.sessionId}/stop`)
      .send({})
      .expect(200);

    expect(stop.body.code).toBe('OK');
    expect(stop.body.data.status).toBe('ended');
    expect(stop.body.data.order.status).toBe('settled');

    const farmerOrders = await request(app.getHttpServer()).get('/api/v1/u/orders').expect(200);
    expect(farmerOrders.body.code).toBe('OK');
    expect(
      farmerOrders.body.data.items.some(
        (item: { id: string; status: string }) => item.id === stop.body.data.order.id && item.status === 'completed'
      )
    ).toBe(true);
  });
});
