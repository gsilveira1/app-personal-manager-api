import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── Health check endpoint (must be registered BEFORE the global prefix) ──
  // Excluded from the /api prefix so fly.io can probe GET /health directly
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.enableCors({ 
    origin: true, // ['http://example.com', 'http://anotherdomain.com']
    methods: 'GET,PUT,POST,PATCH,DELETE',
    credentials: false,
    allowedHeaders: 'Content-Type, Accept, Authorization'
  });

  // Use PORT env var (set by fly.io [env] block) with local fallback
  const port = process.env.PORT ?? 9090;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();