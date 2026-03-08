/**
 * Integration tests for GET /api/settings/language and PATCH /api/settings/language.
 *
 * These tests spin up a full NestJS application with a real Prisma connection
 * to the test database (uses DATABASE_URL from .env). A dedicated test user is
 * created and cleaned up around each suite to ensure isolation.
 *
 * Pre-requisites: DATABASE_URL env var pointing to an accessible PostgreSQL DB.
 * Run with: npm run test:e2e -- --testPathPattern=settings-language
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Settings Language API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtToken: string;
  let userId: string;

  const TEST_USER = {
    name: 'E2E Test User',
    email: `e2e-lang-test-${Date.now()}@test.com`,
    password: 'TestPass123!',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Create test user and obtain JWT
    const signupRes = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send(TEST_USER)
      .expect(201);

    jwtToken = signupRes.body.access_token;
    userId = signupRes.body.user.id;
  });

  afterAll(async () => {
    // Cleanup test user and their settings
    await prisma.userSetting.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await app.close();
  });

  beforeEach(async () => {
    // Reset language preference before each test for isolation
    await prisma.userSetting.deleteMany({
      where: { userId, key: 'preferred_language' },
    });
  });

  const authHeader = () => ({ Authorization: `Bearer ${jwtToken}` });

  // ─── GET /api/settings/language ────────────────────────────────────────────

  describe('GET /api/settings/language', () => {
    it('returns { language: "en" } when no preference is stored', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/settings/language')
        .set(authHeader())
        .expect(200);

      expect(res.body).toEqual({ language: 'en' });
    });

    it('returns stored language after a PATCH', async () => {
      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: 'es' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/settings/language')
        .set(authHeader())
        .expect(200);

      expect(res.body).toEqual({ language: 'es' });
    });

    it('returns 401 without JWT token', async () => {
      await request(app.getHttpServer()).get('/api/settings/language').expect(401);
    });
  });

  // ─── PATCH /api/settings/language ─────────────────────────────────────────

  describe('PATCH /api/settings/language', () => {
    it('stores and returns pt-BR', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: 'pt-BR' })
        .expect(200);

      expect(res.body).toEqual({ language: 'pt-BR' });
    });

    it('rejects unsupported locale "fr" with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: 'fr' })
        .expect(400);

      expect(res.body.message).toBeDefined();
    });

    it('rejects empty string with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: '' })
        .expect(400);
    });

    it('rejects missing language field with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({})
        .expect(400);
    });

    it('returns 401 without JWT token', async () => {
      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .send({ language: 'en' })
        .expect(401);
    });

    it('is idempotent — two PATCHes with same value yield single DB row', async () => {
      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: 'es' })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: 'es' })
        .expect(200);

      const rows = await prisma.userSetting.count({
        where: { userId, key: 'preferred_language' },
      });
      expect(rows).toBe(1);
    });

    it('full round-trip: PATCH es → GET → PATCH en → GET returns en', async () => {
      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: 'es' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/settings/language')
        .set(authHeader())
        .expect(200)
        .expect((r) => expect(r.body).toEqual({ language: 'es' }));

      await request(app.getHttpServer())
        .patch('/api/settings/language')
        .set(authHeader())
        .send({ language: 'en' })
        .expect(200);

      const final = await request(app.getHttpServer())
        .get('/api/settings/language')
        .set(authHeader())
        .expect(200);

      expect(final.body).toEqual({ language: 'en' });
    });
  });
});
