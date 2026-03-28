import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DatabaseService } from '../../src/common/db/database.service';
import { SCENARIOS } from '../support/seed-scenarios';
import { closeTestApp, createTestApp } from '../support/test-app';

describe('seed integrity baseline', () => {
  let app: INestApplication;
  let db: DatabaseService;

  beforeAll(async () => {
    const bootstrap = await createTestApp();
    app = bootstrap.app;
    db = bootstrap.db;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('keeps S03 as a policy missing deny scenario', async () => {
    const policyResult = await db.query<{ count: number }>(
      `select count(*)::int as count from well_runtime_policy where well_id = $1 and status = 'active'`,
      [SCENARIOS.S03.objects.wellId]
    );
    expect(policyResult.rows[0].count).toBe(0);

    const response = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/start-check')
      .send({
        targetType: 'valve',
        targetId: SCENARIOS.S03.objects.valveId,
        sceneCode: SCENARIOS.S03.defaultSceneCode
      })
      .expect(200);

    expect(response.body.code).toBe('OK');
    expect(response.body.data.result).toBe('deny');
    expect(response.body.data.blockingReasons[0].code).toBe('POLICY_NOT_EFFECTIVE');
  });

  it('keeps S04 as a topology/offline deny scenario', async () => {
    const deviceResult = await db.query<{ onlineState: string; lifecycleState: string }>(
      `
      select online_state as "onlineState", lifecycle_state as "lifecycleState"
      from device
      where id = $1
      `,
      [SCENARIOS.S04.objects.offlineDeviceId]
    );
    expect(deviceResult.rows[0]).toMatchObject({
      onlineState: 'offline',
      lifecycleState: 'active'
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/start-check')
      .send({
        targetType: 'valve',
        targetId: SCENARIOS.S04.objects.valveId
      })
      .expect(200);

    expect(response.body.code).toBe('OK');
    expect(response.body.data.result).toBe('deny');
    expect(response.body.data.blockingReasons[0].code).toBe('DEVICE_OFFLINE');
  });

  it('keeps S08 as a fallback allow scenario with explicit source chain', async () => {
    const baseChecks = await db.query<{
      relationConfig: Record<string, unknown>;
      hasWellPolicy: boolean;
      wellInteractionCount: number;
      valveInteractionCount: number;
      templateId: string;
      deviceTypeId: string;
    }>(
      `
      select
        pvr.relation_config_json as "relationConfig",
        exists(select 1 from well_runtime_policy wrp where wrp.well_id = $1 and wrp.status = 'active') as "hasWellPolicy",
        (
          select count(*)::int
          from interaction_policy ip
          where ip.target_type = 'well'
            and ip.scene_code = 'farmer_scan_start'
            and ip.status = 'active'
        ) as "wellInteractionCount",
        (
          select count(*)::int
          from interaction_policy ip
          where ip.target_type = 'valve'
            and ip.scene_code = 'farmer_scan_start'
            and ip.status = 'active'
        ) as "valveInteractionCount",
        st.id as "templateId",
        dt.id as "deviceTypeId"
      from pump_valve_relation pvr
      join scenario_template st on st.id = $2
      join well w on w.id = pvr.well_id
      join device d on d.id = w.device_id
      join device_type dt on dt.id = d.device_type_id
      where pvr.id = $3
      `,
      [
        SCENARIOS.S08.objects.wellId,
        SCENARIOS.S08.objects.scenarioTemplateId,
        SCENARIOS.S08.objects.relationId
      ]
    );

    expect(baseChecks.rows[0].hasWellPolicy).toBe(false);
    expect(baseChecks.rows[0].relationConfig.billingPackageId).toBe(SCENARIOS.S08.objects.billingPackageIdFromRelation);
    expect(baseChecks.rows[0].wellInteractionCount).toBeGreaterThan(0);
    expect(baseChecks.rows[0].valveInteractionCount).toBeGreaterThan(0);
    expect(baseChecks.rows[0].templateId).toBe(SCENARIOS.S08.objects.scenarioTemplateId);
    expect(baseChecks.rows[0].deviceTypeId).toBe(SCENARIOS.S08.objects.wellDeviceTypeId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/start-check')
      .send({
        targetType: 'valve',
        targetId: SCENARIOS.S08.objects.valveId
      })
      .expect(200);

    expect(response.body.code).toBe('OK');
    expect(response.body.data.result).toBe('allow');

    const decision = await db.query<{ snapshot: Record<string, any> }>(
      `select effective_rule_snapshot_json as snapshot from runtime_decision where id = $1`,
      [response.body.data.decisionId]
    );

    expect(decision.rows[0].snapshot.resolved_from.billing_package_source).toBe(
      SCENARIOS.S08.expectedFallbackSources.billingPackageId
    );
    expect(decision.rows[0].snapshot.resolved_from.max_session_minutes_source).toBe(
      SCENARIOS.S08.expectedFallbackSources.maxRunSeconds
    );
    expect(decision.rows[0].snapshot.resolved_from.concurrency_limit_source).toBe(
      SCENARIOS.S08.expectedFallbackSources.concurrencyLimit
    );
    expect(decision.rows[0].snapshot.resolved_from.idle_timeout_seconds_source).toBe(
      SCENARIOS.S08.expectedFallbackSources.idleTimeoutSeconds
    );
    expect(decision.rows[0].snapshot.resolved_from.stop_protection_mode_source).toBe(
      SCENARIOS.S08.expectedFallbackSources.stopProtectionMode
    );
  });
});
