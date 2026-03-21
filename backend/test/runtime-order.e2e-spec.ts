import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/db/database.service';
import { AppExceptionFilter } from '../src/common/http/app-exception.filter';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PRIMARY_USER_ID = '00000000-0000-0000-0000-000000000101';
const ALT_USER_ID = '00000000-0000-0000-0000-000000000103';
const HAPPY_VALVE_ID = '00000000-0000-0000-0000-000000000701';
const OFFLINE_VALVE_ID = '00000000-0000-0000-0000-000000000702';
const FALLBACK_VALVE_ID = '00000000-0000-0000-0000-000000000703';
const POLICY_MISSING_VALVE_ID = '00000000-0000-0000-0000-000000000704';
const FREE_VALVE_ID = '00000000-0000-0000-0000-000000000705';

describe('Runtime + Order Phase 1 chain', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let seedSql: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true
      })
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
    db = app.get(DatabaseService);
    seedSql = readFileSync(join(__dirname, '../sql/seed/001_phase1_demo.sql'), 'utf8');
  });

  beforeEach(async () => {
    await db.query(`
      delete from session_status_log;
      delete from irrigation_order;
      delete from runtime_session;
      delete from runtime_decision;
      delete from interaction_policy where tenant_id = '${TENANT_ID}';
      delete from scenario_template where tenant_id = '${TENANT_ID}';
      delete from well_runtime_policy where tenant_id = '${TENANT_ID}';
      delete from pump_valve_relation where tenant_id = '${TENANT_ID}';
      delete from billing_package where tenant_id = '${TENANT_ID}';
      update device
      set online_state = 'online', lifecycle_state = 'active', runtime_state = 'idle'
      where tenant_id = '${TENANT_ID}';
    `);
    await db.query(seedSql);
    await db.query(`
      update device
      set online_state = 'offline'
      where id = '00000000-0000-0000-0000-000000000406'
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  async function startCheck(targetId: string, sceneCode?: string) {
    return request(app.getHttpServer())
      .post('/api/v1/u/runtime/start-check')
      .send({
        targetType: 'valve',
        targetId,
        ...(sceneCode ? { sceneCode } : {})
      })
      .expect(200);
  }

  async function createSession(decisionId: string) {
    return request(app.getHttpServer())
      .post('/api/v1/u/runtime/sessions')
      .send({ decisionId })
      .expect(200);
  }

  async function stopSession(sessionId: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/u/runtime/sessions/${sessionId}/stop`)
      .send({})
      .expect(200);
  }

  it('creates decision, creates session, stops session, and finalizes order consistently', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    expect(start.body.code).toBe('OK');
    expect(start.body.data.result).toBe('allow');
    expect(start.body.data.pricePreview.billingMode).toBe('duration');
    expect(start.body.data.pricePreview.unitPrice).toBe(1.8);

    const create = await createSession(start.body.data.decisionId);
    expect(create.body.code).toBe('OK');
    expect(create.body.data.status).toBe('running');

    const stop = await stopSession(create.body.data.sessionId);
    expect(stop.body.code).toBe('OK');
    expect(stop.body.data.status).toBe('ended');
    expect(stop.body.data.order.status).toBe('settled');
    expect(Number(stop.body.data.order.amount)).toBeGreaterThanOrEqual(1.8);

    const sessionResult = await db.query<{ status: string; endedAt: string | null }>(
      `select status, ended_at as "endedAt" from runtime_session where id = $1`,
      [create.body.data.sessionId]
    );
    expect(sessionResult.rows[0].status).toBe('ended');
    expect(sessionResult.rows[0].endedAt).toBeTruthy();

    const orderResult = await db.query<{
      status: string;
      settlementStatus: string;
      amount: number;
      pricingDetail: Record<string, any>;
    }>(
      `
      select
        status,
        settlement_status as "settlementStatus",
        amount,
        pricing_detail_json as "pricingDetail"
      from irrigation_order
      where session_id = $1
      `,
      [create.body.data.sessionId]
    );
    expect(orderResult.rows[0].status).toBe('settled');
    expect(orderResult.rows[0].settlementStatus).toBe('paid');
    expect(Number(orderResult.rows[0].amount)).toBeGreaterThanOrEqual(1.8);
    expect(orderResult.rows[0].pricingDetail.preview_final_amount).toBeDefined();
    expect(orderResult.rows[0].pricingDetail.final_amount).toBeGreaterThanOrEqual(1.8);
  });

  it('returns deny with topology blocking reason when device is offline', async () => {
    const response = await startCheck(OFFLINE_VALVE_ID);
    expect(response.body.code).toBe('OK');
    expect(response.body.data.result).toBe('deny');
    expect(response.body.data.pricePreview).toBeNull();
    expect(response.body.data.blockingReasons[0].code).toBe('DEVICE_OFFLINE');
    expect(response.body.data.availableActions[0].code).toBe('retry_later');
  });

  it('returns deny with policy missing when the fixed fallback chain cannot resolve rules', async () => {
    const response = await startCheck(POLICY_MISSING_VALVE_ID, 'policy_missing_scene');
    expect(response.body.code).toBe('OK');
    expect(response.body.data.result).toBe('deny');
    expect(response.body.data.blockingReasons[0].code).toBe('POLICY_NOT_EFFECTIVE');
    expect(response.body.data.availableActions[0].code).toBe('contact_support');
  });

  it('resolves fallback policy sources into auditable decision and session snapshots', async () => {
    const start = await startCheck(FALLBACK_VALVE_ID);
    expect(start.body.code).toBe('OK');
    expect(start.body.data.result).toBe('allow');
    expect(start.body.data.pricePreview.billingMode).toBe('flat');
    expect(start.body.data.pricePreview.unitPrice).toBe(12);

    const create = await createSession(start.body.data.decisionId);
    expect(create.body.code).toBe('OK');

    const decisionResult = await db.query<{ snapshot: Record<string, any> }>(
      `select effective_rule_snapshot_json as snapshot from runtime_decision where id = $1`,
      [start.body.data.decisionId]
    );
    expect(decisionResult.rows[0].snapshot.resolved_from.billing_package_source).toBe('pump_valve_relation');
    expect(decisionResult.rows[0].snapshot.resolved_from.max_session_minutes_source).toBe('interaction_policy');
    expect(decisionResult.rows[0].snapshot.resolved_from.idle_timeout_seconds_source).toBe('device_type_default');
    expect(decisionResult.rows[0].snapshot.resolved_from.stop_protection_mode_source).toBe('scenario_template');

    const sessionResult = await db.query<{ telemetry: Record<string, any> }>(
      `select telemetry_snapshot_json as telemetry from runtime_session where id = $1`,
      [create.body.data.sessionId]
    );
    expect(sessionResult.rows[0].telemetry.effectiveRuleSnapshot.resolved_from.billing_package_source).toBe('pump_valve_relation');
    expect(sessionResult.rows[0].telemetry.effectiveRuleSnapshot.billing.billingMode).toBe('flat');
  });

  it('distinguishes free billing in pricePreview', async () => {
    const response = await startCheck(FREE_VALVE_ID);
    expect(response.body.code).toBe('OK');
    expect(response.body.data.result).toBe('allow');
    expect(response.body.data.pricePreview.billingMode).toBe('free');
    expect(response.body.data.pricePreview.unitPrice).toBe(0);
  });

  it('rejects create-session when decision has expired', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    await db.query(`update runtime_decision set decision_expires_at = now() - interval '1 minute' where id = $1`, [
      start.body.data.decisionId
    ]);

    const create = await createSession(start.body.data.decisionId);
    expect(create.body.code).toBe('DECISION_EXPIRED');
    expect(create.body.data.status).toBe('expired');
  });

  it('returns deny when user concurrency is exceeded during start-check', async () => {
    const firstStart = await startCheck(HAPPY_VALVE_ID);
    const firstSession = await createSession(firstStart.body.data.decisionId);
    expect(firstSession.body.code).toBe('OK');

    const secondStart = await startCheck(FREE_VALVE_ID);
    expect(secondStart.body.code).toBe('OK');
    expect(secondStart.body.data.result).toBe('deny');
    expect(secondStart.body.data.blockingReasons.some((item: { code: string }) => item.code === 'CONCURRENCY_LIMIT_REACHED')).toBe(true);
    expect(secondStart.body.data.availableActions[0].code).toBe('retry_later');
    expect(secondStart.body.data.pricePreview).toBeNull();
  });

  it('re-checks concurrency during create-session and does not create side effects on denied second guard', async () => {
    const guardedStart = await startCheck(FREE_VALVE_ID);
    expect(guardedStart.body.data.result).toBe('allow');

    const happyStart = await startCheck(HAPPY_VALVE_ID);
    const happySession = await createSession(happyStart.body.data.decisionId);
    expect(happySession.body.code).toBe('OK');

    const create = await createSession(guardedStart.body.data.decisionId);
    expect(create.body.code).toBe('CONCURRENCY_LIMIT_REACHED');
    expect(create.body.data.blockingReasons[0].code).toBe('CONCURRENCY_LIMIT_REACHED');

    const result = await db.query<{ count: number }>(
      `select count(*)::int as count from runtime_session where source_decision_id = $1`,
      [guardedStart.body.data.decisionId]
    );
    expect(result.rows[0].count).toBe(0);
  });

  it('returns stable business response when decision is already consumed', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    const firstCreate = await createSession(start.body.data.decisionId);
    expect(firstCreate.body.code).toBe('OK');

    const secondCreate = await createSession(start.body.data.decisionId);
    expect(secondCreate.body.code).toBe('DECISION_ALREADY_CONSUMED');
    expect(secondCreate.body.data.idempotent).toBe(true);
    expect(secondCreate.body.data.sessionId).toBe(firstCreate.body.data.sessionId);
  });

  it('duplicate create-session retry does not create duplicate session or order', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    const firstCreate = await createSession(start.body.data.decisionId);
    const secondCreate = await createSession(start.body.data.decisionId);

    expect(secondCreate.body.code).toBe('DECISION_ALREADY_CONSUMED');

    const sessionCount = await db.query<{ count: number }>(
      `select count(*)::int as count from runtime_session where source_decision_id = $1`,
      [start.body.data.decisionId]
    );
    const orderCount = await db.query<{ count: number }>(
      `select count(*)::int as count from irrigation_order where session_id = $1`,
      [firstCreate.body.data.sessionId]
    );
    expect(sessionCount.rows[0].count).toBe(1);
    expect(orderCount.rows[0].count).toBe(1);
  });

  it('returns stable business payload when decision is not visible', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    await db.query(`update runtime_decision set user_id = $1 where id = $2`, [ALT_USER_ID, start.body.data.decisionId]);

    const create = await createSession(start.body.data.decisionId);
    expect(create.body.code).toBe('DATA_SCOPE_DENIED');
    expect(create.body.data.status).toBe('forbidden');
  });

  it('returns stable business payload when session is not visible', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    const create = await createSession(start.body.data.decisionId);
    await db.query(`update runtime_session set user_id = $1 where id = $2`, [ALT_USER_ID, create.body.data.sessionId]);

    const stop = await stopSession(create.body.data.sessionId);
    expect(stop.body.code).toBe('SESSION_NOT_VISIBLE');
    expect(stop.body.data.status).toBe('forbidden');
  });

  it('stops idempotently without duplicating settlement or order amount', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    const create = await createSession(start.body.data.decisionId);
    const firstStop = await stopSession(create.body.data.sessionId);
    const secondStop = await stopSession(create.body.data.sessionId);

    expect(firstStop.body.code).toBe('OK');
    expect(secondStop.body.code).toBe('SESSION_ALREADY_ENDED');
    expect(secondStop.body.data.idempotent).toBe(true);
    expect(Number(secondStop.body.data.order.amount)).toBe(Number(firstStop.body.data.order.amount));

    const orderCount = await db.query<{ count: number }>(
      `select count(*)::int as count from irrigation_order where session_id = $1`,
      [create.body.data.sessionId]
    );
    expect(orderCount.rows[0].count).toBe(1);
  });

  it('returns stable business payload when stopping a missing session', async () => {
    const stop = await stopSession('11111111-1111-1111-1111-111111111111');
    expect(stop.body.code).toBe('SESSION_NOT_FOUND');
    expect(stop.body.data.status).toBe('not_found');
  });

  it('writes session_status_log on create, stop accepted, stop completed, and settle', async () => {
    const start = await startCheck(HAPPY_VALVE_ID);
    const create = await createSession(start.body.data.decisionId);
    const stop = await stopSession(create.body.data.sessionId);

    expect(stop.body.code).toBe('OK');

    const logs = await db.query<{
      fromStatus: string | null;
      toStatus: string;
      actionCode: string;
      reasonCode: string | null;
      source: string;
    }>(
      `
      select
        from_status as "fromStatus",
        to_status as "toStatus",
        action_code as "actionCode",
        reason_code as "reasonCode",
        source
      from session_status_log
      where session_id = $1
      order by case action_code
        when 'create_session' then 1
        when 'stop_session_accepted' then 2
        when 'stop_session_completed' then 3
        when 'settle_success' then 4
        else 99
      end asc, created_at asc
      `,
      [create.body.data.sessionId]
    );

    expect(logs.rows).toHaveLength(4);
    expect(logs.rows[0]).toMatchObject({ fromStatus: 'created', toStatus: 'running', actionCode: 'create_session', source: 'runtime_engine' });
    expect(logs.rows[1]).toMatchObject({ fromStatus: 'running', toStatus: 'ending', actionCode: 'stop_session_accepted', source: 'manual' });
    expect(logs.rows[2]).toMatchObject({ fromStatus: 'ending', toStatus: 'ended', actionCode: 'stop_session_completed', source: 'runtime_engine' });
    expect(logs.rows[3]).toMatchObject({ fromStatus: 'ended', toStatus: 'settled', actionCode: 'settle_success', source: 'runtime_engine' });
  });

  it('stores pricing audit detail with preview and final delta on settlement', async () => {
    const start = await startCheck(FALLBACK_VALVE_ID);
    const create = await createSession(start.body.data.decisionId);
    await stopSession(create.body.data.sessionId);

    const order = await db.query<{ pricingDetail: Record<string, any> }>(
      `select pricing_detail_json as "pricingDetail" from irrigation_order where session_id = $1`,
      [create.body.data.sessionId]
    );

    expect(order.rows[0].pricingDetail.billing_mode).toBe('flat');
    expect(order.rows[0].pricingDetail.preview_final_amount).toBe(12);
    expect(order.rows[0].pricingDetail.final_amount).toBe(12);
    expect(order.rows[0].pricingDetail.preview_delta_amount).toBe(0);
    expect(order.rows[0].pricingDetail.effective_rule_snapshot_ref.resolved_from.billing_package_source).toBe('pump_valve_relation');
  });
});
