import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/modules/app.module';

describe('Payload Size Limit (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(json({ limit: '10mb' }));
    app.use(urlencoded({ limit: '10mb', extended: true }));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should accept JSON request body larger than 100KB without PayloadTooLargeError (413)', async () => {
    // Generate a ~500KB payload
    const largeData = 'a'.repeat(500 * 1024);

    // Request endpoint and verify HTTP 413 is not returned
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password', extra: largeData });

    // Should NOT be 413 Payload Too Large
    expect(res.status).not.toBe(413);
  });
});
