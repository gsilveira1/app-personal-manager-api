import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  await app.listen(9090);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();