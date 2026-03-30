import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/common/db/database.service';
import { AppExceptionFilter } from '../../src/common/http/app-exception.filter';
import { SCENARIOS } from '../support/seed-scenarios';

const ACTIVE_SESSION_ID = SCENARIOS.S06.objects.sessionId;
const COMMAND_SOURCE = 'e2e_http_bridge';
const BRIDGE_ID = 'e2e-http-bridge';

function runPythonScript(args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('python', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`python exited with ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

describe('device gateway http bridge', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let baseUrl: string;
  const originalGatewayPort = process.env.DEVICE_GATEWAY_TCP_PORT;

  beforeAll(async () => {
    process.env.DEVICE_GATEWAY_TCP_PORT = '19021';

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
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();

    db = app.get(DatabaseService);
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
        and connection_id like $2
      `,
      ['00000000-0000-0000-0000-000000000001', `bridge:${BRIDGE_ID}%`]
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

  async function queueRetryPendingCommand(context: { sessionId: string; sessionRef: string | null; imei: string }) {
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
          scenario: 'http-bridge-recovery'
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

    return { commandId };
  }

  it('connects and disconnects an http bridge connection', async () => {
    const context = await resolveSessionContext();

    const connected = await request(app.getHttpServer())
      .post('/api/v1/ops/device-gateway/bridge/connect')
      .send({
        imei: context.imei,
        bridge_id: BRIDGE_ID,
        remote_addr: 'bridge.local',
        remote_port: 8080
      })
      .expect(201);

    expect(connected.body.code).toBe('OK');
    expect(connected.body.data.bound).toBe(true);
    expect(connected.body.data.connection_id).toBe(`bridge:${BRIDGE_ID}:${context.imei}`);

    const health = await request(app.getHttpServer())
      .get('/api/v1/ops/device-gateway/connection-health')
      .expect(200);

    expect(health.body.data.connection_mode).toBe('heartbeat_plus_transport_session');
    expect(health.body.data.transport_modes).toEqual(expect.arrayContaining(['tcp_socket', 'http_bridge']));

    const disconnected = await request(app.getHttpServer())
      .post('/api/v1/ops/device-gateway/bridge/disconnect')
      .send({
        imei: context.imei,
        bridge_id: BRIDGE_ID
      })
      .expect(201);

    expect(disconnected.body.code).toBe('OK');
    expect(disconnected.body.data.closed).toBe(true);
  });

  it('exposes serial bridge contract and the Python bridge can run one-shot against the app', async () => {
    const context = await resolveSessionContext();

    const contract = await request(app.getHttpServer())
      .get('/api/v1/ops/device-gateway/contract')
      .expect(200);

    expect(contract.body.data.transport_modes).toEqual(
      expect.arrayContaining(['tcp_socket', 'http_bridge', 'serial_bridge'])
    );
    expect(contract.body.data.serial_bridge).toEqual(
      expect.objectContaining({
        mode: 'external_python_bridge',
        script_path: 'backend/scripts/device_gateway_serial_bridge.py',
        python_module: 'pyserial',
        line_protocol: 'newline_delimited_json'
      })
    );

    const scriptPath = resolve(__dirname, '../../scripts/device_gateway_serial_bridge.py');
    const result = await runPythonScript([
        scriptPath,
        '--port',
        'loop://',
        '--imei',
        context.imei,
        '--base-url',
        `${baseUrl}/api/v1/ops/device-gateway`,
        '--bridge-id',
        `${BRIDGE_ID}-serial`,
        '--no-dispatch-pending',
        '--once'
      ]);

    expect(result.stdout).toContain('"bridge": "connect"');
    expect(result.stdout).toContain('"bridge": "heartbeat"');
    expect(result.stdout).toContain('"bridge": "disconnect"');
  });

  it('reactivates retry-pending commands through bridge heartbeat', async () => {
    const context = await resolveSessionContext();
    const queued = await queueRetryPendingCommand(context);

    const heartbeat = await request(app.getHttpServer())
      .post('/api/v1/ops/device-gateway/bridge/heartbeat')
      .send({
        imei: context.imei,
        bridge_id: BRIDGE_ID,
        session_ref: context.sessionRef,
        payload: {
          signal_dbm: -63,
          bridge_tag: 'e2e'
        }
      })
      .expect(201);

    expect(heartbeat.body.code).toBe('OK');
    expect(heartbeat.body.data.connection.bound).toBe(true);
    expect(heartbeat.body.data.event.ingested).toBe(true);
    expect(heartbeat.body.data.event.recovery.reactivated_retry_command_ids).toEqual(
      expect.arrayContaining([queued.commandId])
    );
    expect(heartbeat.body.data.pending_command_delivery.enabled).toBe(true);
    expect(heartbeat.body.data.pending_command_delivery.mark_sent).toBe(true);
    expect(heartbeat.body.data.pending_commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: queued.commandId,
          command_status: 'sent'
        })
      ])
    );

    const pending = await request(app.getHttpServer())
      .get('/api/v1/ops/device-gateway/pending-commands')
      .query({
        imei: context.imei,
        mark_sent: 'false',
        include_sent: 'true'
      })
      .expect(200);

    const matched = pending.body.data.items.find((item: { id: string }) => item.id === queued.commandId);
    expect(matched).toBeDefined();
    expect(matched.command_status).toBe('sent');
  });
});
