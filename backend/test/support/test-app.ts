import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/common/db/database.service';
import { AppExceptionFilter } from '../../src/common/http/app-exception.filter';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  }).compile();

  const app = moduleRef.createNestApplication();
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

  return {
    app,
    db: app.get(DatabaseService) as DatabaseService
  };
}

export async function closeTestApp(app: INestApplication) {
  await app.close();
}
