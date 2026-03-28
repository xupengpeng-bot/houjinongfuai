import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/http/app-exception.filter';
import { SCENARIOS } from '../support/seed-scenarios';

const HAPPY_VALVE_ID = SCENARIOS.S01.objects.valveId;

describe('runtime-order phase1 smoke', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the seeded S01 happy path from start-check to settled order', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/v1/u/runtime/start-check')
      .send({
        targetType: 'valve',
        targetId: HAPPY_VALVE_ID
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

    const stop = await request(app.getHttpServer())
      .post(`/api/v1/u/runtime/sessions/${create.body.data.sessionId}/stop`)
      .send({})
      .expect(200);

    expect(stop.body.code).toBe('OK');
    expect(stop.body.data.status).toBe('ended');
    expect(stop.body.data.order.status).toBe('settled');
  });
});
