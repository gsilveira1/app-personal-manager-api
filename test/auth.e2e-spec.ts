/**
 * Auth API — Integration test (e2e)
 *
 * Tests the complete authentication flow that exercises the full
 * NestJS → AuthService → UsersService → PrismaService → PostgreSQL stack.
 *
 * Pre-requisites:
 *   - DATABASE_URL env var pointing to a running PostgreSQL instance
 *   - Run `docker compose up -d postgres` before executing these tests
 *
 * A unique test user is created in beforeAll and fully cleaned up in afterAll
 * to ensure the suite is idempotent and does not pollute the database.
 *
 * Run: npm run test:e2e -- --testPathPattern=auth
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/modules/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

// Unique suffix per test run so parallel CI workers don't conflict
const SUFFIX = Date.now();

describe('Auth API (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    const TEST_USER = {
        name: 'E2E Auth User',
        email: `e2e-auth-${SUFFIX}@test.com`,
        password: 'AuthPass123!',
    };

    let createdUserId: string;
    let accessToken: string;

    // ─── Bootstrap ─────────────────────────────────────────────────────────────

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();

        // Mirror main.ts exactly
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
                transformOptions: { enableImplicitConversion: true },
            }),
        );

        await app.init();

        prisma = moduleRef.get<PrismaService>(PrismaService);
    }, 30_000);

    afterAll(async () => {
        // Clean up all test data created by this suite
        if (createdUserId) {
            await prisma.userSetting.deleteMany({ where: { userId: createdUserId } }).catch(() => { });
            await prisma.user.delete({ where: { id: createdUserId } }).catch(() => { });
        }
        await app.close();
    });

    // ─── POST /api/auth/signup ─────────────────────────────────────────────────

    describe('POST /api/auth/signup', () => {
        it('creates a new user and returns access_token + user object (no password)', async () => {
            const res = await request(app.getHttpServer())
                .post('/api/auth/signup')
                .send(TEST_USER)
                .expect(201);

            expect(res.body).toHaveProperty('access_token');
            expect(typeof res.body.access_token).toBe('string');
            expect(res.body.user).toHaveProperty('id');
            expect(res.body.user.email).toBe(TEST_USER.email);
            expect(res.body.user.name).toBe(TEST_USER.name);
            expect(res.body.user).not.toHaveProperty('password');

            createdUserId = res.body.user.id;
        });

        it('returns 409 Conflict when the same email is used again', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/signup')
                .send(TEST_USER)
                .expect(409);
        });

        it('returns 400 Bad Request for missing required fields', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/signup')
                .send({ email: `missing-name-${SUFFIX}@test.com`, password: 'Pass123!' })
                .expect(400);
        });

        it('returns 400 Bad Request for invalid email format', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/signup')
                .send({ name: 'Bad Email', email: 'not-an-email', password: 'Pass123!' })
                .expect(400);
        });

        it('returns 400 Bad Request when password is too short', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/signup')
                .send({ name: 'Short Pass', email: `short-${SUFFIX}@test.com`, password: '123' })
                .expect(400);
        });
    });

    // ─── POST /api/auth/login ──────────────────────────────────────────────────

    describe('POST /api/auth/login', () => {
        it('returns access_token and user object for valid credentials', async () => {
            const res = await request(app.getHttpServer())
                .post('/api/auth/login')
                .send({ email: TEST_USER.email, password: TEST_USER.password })
                .expect(201);

            expect(res.body).toHaveProperty('access_token');
            expect(typeof res.body.access_token).toBe('string');
            expect(res.body.user.email).toBe(TEST_USER.email);
            expect(res.body.user).not.toHaveProperty('password');

            // Store token for subsequent tests
            accessToken = res.body.access_token;
        });

        it('returns 401 Unauthorized for wrong password', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/login')
                .send({ email: TEST_USER.email, password: 'wrongpassword' })
                .expect(401);
        });

        it('returns 401 Unauthorized for non-existent email', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/login')
                .send({ email: 'nobody@nowhere.com', password: 'anything' })
                .expect(401);
        });

        it('returns 400 Bad Request when body is empty', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/login')
                .send({})
                .expect(400);
        });
    });

    // ─── GET /api/auth/me ─────────────────────────────────────────────────────

    describe('GET /api/auth/me', () => {
        it('returns user profile when Bearer token is valid', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            expect(res.body.email).toBe(TEST_USER.email);
            expect(res.body.name).toBe(TEST_USER.name);
            expect(res.body).not.toHaveProperty('password');
        });

        it('returns 401 without an Authorization header', async () => {
            await request(app.getHttpServer()).get('/api/auth/me').expect(401);
        });

        it('returns 401 with a malformed/invalid token', async () => {
            await request(app.getHttpServer())
                .get('/api/auth/me')
                .set('Authorization', 'Bearer invalidtoken')
                .expect(401);
        });
    });

    // ─── POST /api/auth/logout ────────────────────────────────────────────────

    describe('POST /api/auth/logout', () => {
        it('returns 200 OK with a success message', async () => {
            const res = await request(app.getHttpServer())
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('message');
        });

        it('returns 401 when called without a token', async () => {
            await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
        });
    });

    // ─── Prisma ↔ PostgreSQL connectivity ────────────────────────────────────

    describe('Prisma ↔ PostgreSQL connectivity', () => {
        it('can execute a raw query against the database', async () => {
            const result = await prisma.$queryRawUnsafe<{ version: string }[]>('SELECT version()');
            expect(result[0].version).toMatch(/PostgreSQL/i);
        });

        it('the created test user exists in the database', async () => {
            const user = await prisma.user.findUnique({
                where: { email: TEST_USER.email },
            });
            expect(user).not.toBeNull();
            expect(user!.email).toBe(TEST_USER.email);
        });

        it('passwords are stored as bcrypt hashes, never plain text', async () => {
            const user = await prisma.user.findUnique({
                where: { email: TEST_USER.email },
            });
            expect(user).not.toBeNull();
            // bcrypt hashes always start with $2b$
            expect(user!.password).toMatch(/^\$2[ab]\$/);
            expect(user!.password).not.toBe(TEST_USER.password);
        });
    });
});
