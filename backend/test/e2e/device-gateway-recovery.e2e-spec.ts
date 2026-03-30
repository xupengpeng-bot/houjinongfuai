import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/common/db/database.service';
import { AppExceptionFilter } from '../../src/common/http/app-exception.filter';
import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';
import { SCENARIOS } from '../support/seed-scenarios';

const ACTIVE_SESSION_ID = SCENARIOS.S06.objects.sessionId;
const COMMAND_SOURCE = 'e2e_connection_recovery';

describe('device gateway recovery automation', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let gatewayService: DeviceGatewayService;
  const originalGatewayPort = process.env.DEVICE_GATEWAY_TCP_PORT;

  beforeAll(async () => {
    process.env.DEVICE_GATEWAY_TCP_PORT = '19022';

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
    gatewayService = app.get(DeviceGatewayService);
  });

  afterEach(async () => {
    await db.query(
      `
      delete from command_dispatch
      where tenant_id = $1
        and request_payload_json->>'source' = $2
      `,
      ['00000000-0000-0000-0000-000000000001', COMMAND_SOURCE]
    );

    await db.query(
      `
      delete from device_command
      where tenant_id = $1
        and request_payload_json->>'source' = $2
      `,
      ['00000000-0000-0000-0000-000000000001', COMMAND_SOURCE]
    );

    await db.query(
      `
      delete from device_connection_session
      where tenant_id = $1
        and connection_id like 'e2e-recovery-%'
      `,
      ['00000000-0000-0000-0000-000000000001']
    );
  });

  afterAll(async () => {
    await app.close();
    if (originalGatewayPort === undefined) {
      delete process.env.DEVICE_GATEWAY_TCP_PORT;
    } else {
      process.env.DEVICE_GATEWAY_TCP_PORT = originalGatewayPort;
    }
  });

  async function resolveSessionContext() {
    const session = await db.query<{ id: string; sessionRef: string | null; deviceKey: string }>(
      `
      select
        id,
        session_ref as "sessionRef",
        device_key as "deviceKey"
      from runtime_session
      where id = $1::uuid
      limit 1
      `,
      [ACTIVE_SESSION_ID]
    );

    const sessionRow = session.rows[0];
    expect(sessionRow).toBeDefined();

    const device = await db.query<{ id: string; imei: string }>(
      `
      select id, imei
      from device
      where tenant_id = $1
        and imei = $2
      limit 1
      `,
      ['00000000-0000-0000-0000-000000000001', sessionRow.deviceKey]
    );

    const deviceRow = device.rows[0];
    expect(deviceRow).toBeDefined();

    return {
      sessionId: sessionRow.id,
      sessionRef: sessionRow.sessionRef,
      imei: sessionRow.deviceKey,
      deviceId: deviceRow.id
    };
  }

  async function queueRetryPendingCommand(context: {
    sessionId: string;
    sessionRef: string | null;
    imei: string;
  }) {
    const queued = await request(app.getHttpServer())
      .post('/api/v1/ops/device-gateway/commands')
      .send({
        imei: context.imei,
        session_id: context.sessionId,
        session_ref: context.sessionRef,
        command_code: 'START_PUMP',
        create_dispatch: true,
        source: COMMAND_SOURCE,
        request_payload: {
          source: COMMAND_SOURCE,
          scenario: 'recovery-e2e'
        }
      })
      .expect(201);

    const commandId = queued.body.data.command.id as string;
    const commandToken = queued.body.data.command.command_token as string;

    await db.query(
      `
      update device_command
      set command_status = 'retry_pending',
          sent_at = null,
          acked_at = null,
          failed_at = null,
          timeout_at = null,
          response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [
        commandId,
        JSON.stringify({
          transport: {
            retry_count: 1,
            next_retry_at: '2099-01-01T00:00:00.000Z',
            last_transition: 'timeout_requeue'
          }
        })
      ]
    );

    await db.query(
      `
      update command_dispatch
      set dispatch_status = 'retry_pending',
          sent_at = null,
          acked_at = null,
          response_payload_json = coalesce(response_payload_json, '{}'::jsonb) || $2::jsonb
      where tenant_id = $1
        and request_payload_json->>'device_command_token' = $3
      `,
      [
        '00000000-0000-0000-0000-000000000001',
        JSON.stringify({
          transport: {
            retry_count: 1,
            next_retry_at: '2099-01-01T00:00:00.000Z',
            last_transition: 'timeout_requeue'
          }
        }),
        commandToken
      ]
    );

    return { commandId, commandToken };
  }

  it('reactivates retry-pending commands when a heartbeat restores the device', async () => {
    const context = await resolveSessionContext();
    const queued = await queueRetryPendingCommand(context);
    const seqNo = Math.floor(Date.now() % 1000000);

    const recovery = await request(app.getHttpServer())
      .post('/api/v1/ops/device-gateway/runtime-events')
      .send({
        protocolVersion: 'tcp-json-v1',
        imei: context.imei,
        msgId: `e2e-heartbeat-${Date.now()}`,
        msgType: 'HEARTBEAT',
        seqNo,
        sessionRef: context.sessionRef,
        serverRxTs: new Date().toISOString(),
        payload: {
          state: 'connected'
        }
      });
    expect(recovery.status).toBe(201);

    expect(recovery.body.code).toBe('OK');
    expect(recovery.body.data.recovery.reactivated_retry_command_ids).toEqual(
      expect.arrayContaining([queued.commandId])
    );

    const pending = await request(app.getHttpServer())
      .get('/api/v1/ops/device-gateway/pending-commands')
      .query({
        imei: context.imei,
        mark_sent: 'false'
      })
      .expect(200);

    const matched = pending.body.data.items.find((item: { id: string }) => item.id === queued.commandId);
    expect(matched).toBeDefined();
    expect(matched.command_status).toBe('created');
  });

  it('reactivates retry-pending commands when TCP connection binding recovers the device', async () => {
    const context = await resolveSessionContext();
    const queued = await queueRetryPendingCommand(context);

    const result = await gatewayService.bindConnectionSession({
      imei: context.imei,
      connectionId: `e2e-recovery-${Date.now()}`,
      transportType: 'tcp',
      protocolVersion: 'tcp-json-v1',
      remoteAddr: '127.0.0.1',
      remotePort: 19001
    });

    expect(result.bound).toBe(true);
    if (!result.bound || !('reactivated_retry_command_count' in result)) {
      throw new Error(`bindConnectionSession failed: ${JSON.stringify(result)}`);
    }
    expect(result.reactivated_retry_command_count).toBeGreaterThanOrEqual(1);

    const pending = await request(app.getHttpServer())
      .get('/api/v1/ops/device-gateway/pending-commands')
      .query({
        imei: context.imei,
        mark_sent: 'false'
      })
      .expect(200);

    const matched = pending.body.data.items.find((item: { id: string }) => item.id === queued.commandId);
    expect(matched).toBeDefined();
    expect(matched.command_status).toBe('created');
  });
});
