import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppExceptionFilter } from './common/http/app-exception.filter';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  /** 开发态允许任意 localhost / 127.0.0.1 端口，避免换端口后登录成功但 API 被 CORS 拦截导致白屏 */
  const devOrigins = process.env.NODE_ENV !== 'production';
  app.enableCors({
    origin: devOrigins
      ? (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) return callback(null, true);
          try {
            const u = new URL(origin);
            if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return callback(null, true);
          } catch {
            /* ignore */
          }
          callback(null, false);
        }
      : [
          'http://127.0.0.1:5173',
          'http://localhost:5173',
          'http://127.0.0.1:8080',
          'http://localhost:8080'
        ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Dispatch-Write-Key', 'X-Farmer-Card-Token']
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true
    })
  );
  app.useGlobalFilters(new AppExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
