/**
 * 🚀 Smoke Test Battery — All Endpoints
 *
 * Boots the full NestJS application once, creates all necessary test data in
 * `beforeAll` and tears everything down in `afterAll`. Covers every route with
 * minimal happy-path assertions and verifies that JWT guards reject unauthorized
 * requests with 401 (or 403 for role-restricted routes).
 *
 * Run:
 *   npm run test:smoke          (this file only)
 *   npm run test:e2e            (all e2e suites)
 *
 * Pre-requisites: DATABASE_URL env var pointing to an accessible PostgreSQL DB.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/modules/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

// ─── Unique suffix so parallel CI workers don't conflict ─────────────────────
const S = Date.now();

// ─── Shared state populated in beforeAll ────────────────────────────────────
let app: INestApplication;
let prisma: PrismaService;
let token: string;        // JWT for authenticated requests
let userId: string;

// Resource IDs created during setup (needed for route params & cleanup)
let planId: string;
let clientId: string;
let workoutId: string;
let sessionId: string;
let evaluationId: string;
let availabilityBlockId: string;

// ─── Auth header helper ──────────────────────────────────────────────────────
const auth = () => ({ Authorization: `Bearer ${token}` });

// ─── Test fixtures ───────────────────────────────────────────────────────────
const TEST_USER = {
    name: 'Smoke User',
    email: `smoke-${S}@test.com`,
    password: 'SmokePa$$123',
};

const PLAN_PAYLOAD = {
    type: 'PRESENCIAL',
    name: `Smoke Plan ${S}`,
    sessionsPerWeek: 3,
    price: 299.9,
};

const CLIENT_PAYLOAD = {
    name: `Smoke Client ${S}`,
    email: `smoke-client-${S}@test.com`,
    phone: '+5511900000000',
    type: 'In-Person',
};

const WORKOUT_PAYLOAD = {
    title: `Smoke Workout ${S}`,
    exercises: [{ name: 'Squat', sets: 3, reps: '10' }],
};

const AVAILABILITY_PAYLOAD = {
    title: `Smoke Block ${S}`,
    dtstart: new Date(Date.now() + 86_400_000).toISOString(),
    dtend: new Date(Date.now() + 90_000_000).toISOString(),
};

// ─── Bootstrap ───────────────────────────────────────────────────────────────

beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Register the /health route the same way main.ts does
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.get('/health', (_req: any, res: any) =>
        res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }),
    );
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

    // 1. Sign up + capture JWT
    const signupRes = await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send(TEST_USER)
        .expect(201);

    token = signupRes.body.access_token;
    userId = signupRes.body.user.id;

    // 2. Create a Plan (needed by Client and Session)
    const planRes = await request(app.getHttpServer())
        .post('/api/plans')
        .set(auth())
        .send(PLAN_PAYLOAD)
        .expect(201);
    planId = planRes.body.id;

    // 3. Create a Client (needed by Session and Evaluation)
    const clientRes = await request(app.getHttpServer())
        .post('/api/clients')
        .set(auth())
        .send({ ...CLIENT_PAYLOAD, planId })
        .expect(201);
    clientId = clientRes.body.id;

    // 4. Create a Workout
    const workoutRes = await request(app.getHttpServer())
        .post('/api/workouts')
        .set(auth())
        .send(WORKOUT_PAYLOAD)
        .expect(201);
    workoutId = workoutRes.body.id;

    // 5. Create a Session
    const sessionRes = await request(app.getHttpServer())
        .post('/api/sessions')
        .set(auth())
        .send({
            date: new Date(Date.now() + 86_400_000).toISOString(),
            durationMinutes: 60,
            type: 'In-Person',
            category: 'Workout',
            clientId,
        })
        .expect(201);
    sessionId = sessionRes.body.id;

    // 6. Create an Evaluation
    const evalRes = await request(app.getHttpServer())
        .post('/api/evaluations')
        .set(auth())
        .send({
            clientId,
            date: new Date().toISOString(),
            weight: 75.5,
        })
        .expect(201);
    evaluationId = evalRes.body.id;

    // 7. Create an Availability Block
    const blockRes = await request(app.getHttpServer())
        .post('/api/availability-blocks')
        .set(auth())
        .send(AVAILABILITY_PAYLOAD)
        .expect(201);
    availabilityBlockId = blockRes.body.id;
}, 60_000);

afterAll(async () => {
    // Tear down in reverse dependency order
    if (availabilityBlockId) {
        await prisma.availabilityBlock.delete({ where: { id: availabilityBlockId } }).catch(() => { });
    }
    if (evaluationId) {
        await prisma.evaluation.delete({ where: { id: evaluationId } }).catch(() => { });
    }
    if (sessionId) {
        await prisma.session.deleteMany({ where: { id: sessionId } }).catch(() => { });
    }
    if (workoutId) {
        await prisma.workoutPlan.delete({ where: { id: workoutId } }).catch(() => { });
    }
    if (clientId) {
        await prisma.client.delete({ where: { id: clientId } }).catch(() => { });
    }
    if (planId) {
        await prisma.plan.delete({ where: { id: planId } }).catch(() => { });
    }
    if (userId) {
        await prisma.userSetting.deleteMany({ where: { userId } }).catch(() => { });
        await prisma.user.delete({ where: { id: userId } }).catch(() => { });
    }
    await app.close();
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════════

describe('🚀 Smoke Tests — All Endpoints', () => {

    // ── Public endpoints ────────────────────────────────────────────────────────

    describe('Public endpoints', () => {
        it('GET /health → 200', async () => {
            await request(app.getHttpServer()).get('/health').expect(200);
        });

        it('GET /api/sessions/available → 200 (empty array when no TRAINER_USER_ID)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/sessions/available')
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/plans/public/:trainerId → 200 (returns {presencial, consultoria} shape)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/plans/public/00000000-0000-0000-0000-000000000000')
                .expect(200);
            expect(res.body).toHaveProperty('presencial');
            expect(res.body).toHaveProperty('consultoria');
            expect(Array.isArray(res.body.presencial)).toBe(true);
            expect(Array.isArray(res.body.consultoria)).toBe(true);
        });

        it('POST /api/leads → 201 (public lead submission)', async () => {
            await request(app.getHttpServer())
                .post('/api/leads')
                .send({
                    name: `Lead ${S}`,
                    email: `lead-${S}@test.com`,
                    phone: '+5511900000001',
                    interest: 'presencial',
                })
                .expect(201);
        });

        it('POST /api/leads → 400 for invalid body', async () => {
            await request(app.getHttpServer())
                .post('/api/leads')
                .send({ name: 'Missing fields' })
                .expect(400);
        });
    });

    // ── Auth ────────────────────────────────────────────────────────────────────

    describe('Auth', () => {
        it('POST /api/auth/signup → 409 for duplicate email', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/signup')
                .send(TEST_USER)
                .expect(409);
        });

        it('POST /api/auth/login → 201 with access_token + user', async () => {
            const res = await request(app.getHttpServer())
                .post('/api/auth/login')
                .send({ email: TEST_USER.email, password: TEST_USER.password })
                .expect(201);
            expect(res.body).toHaveProperty('access_token');
            expect(res.body.user.email).toBe(TEST_USER.email);
        });

        it('POST /api/auth/login → 401 for wrong password', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/login')
                .send({ email: TEST_USER.email, password: 'wrongpassword' })
                .expect(401);
        });

        it('GET /api/auth/me → 200 with user data', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/auth/me')
                .set(auth())
                .expect(200);
            expect(res.body.email).toBe(TEST_USER.email);
            expect(res.body).not.toHaveProperty('password');
        });

        it('GET /api/auth/me → 401 without token', async () => {
            await request(app.getHttpServer()).get('/api/auth/me').expect(401);
        });

        it('POST /api/auth/logout → 200', async () => {
            await request(app.getHttpServer())
                .post('/api/auth/logout')
                .set(auth())
                .expect(200);
        });
    });

    // ── Plans ───────────────────────────────────────────────────────────────────

    describe('Plans CRUD', () => {
        it('GET /api/plans → 200 (array)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/plans')
                .set(auth())
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/plans/:id → 200 with the created plan', async () => {
            const res = await request(app.getHttpServer())
                .get(`/api/plans/${planId}`)
                .set(auth())
                .expect(200);
            expect(res.body.id).toBe(planId);
        });

        it('PATCH /api/plans/:id → 200 after update', async () => {
            const res = await request(app.getHttpServer())
                .patch(`/api/plans/${planId}`)
                .set(auth())
                .send({ name: `Updated Plan ${S}` })
                .expect(200);
            expect(res.body.name).toBe(`Updated Plan ${S}`);
        });

        it('GET /api/plans → 401 without token', async () => {
            await request(app.getHttpServer()).get('/api/plans').expect(401);
        });
    });

    // ── Clients ─────────────────────────────────────────────────────────────────

    describe('Clients CRUD', () => {
        it('GET /api/clients → 200 (array)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/clients')
                .set(auth())
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/clients/leads → 200 (array)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/clients/leads')
                .set(auth())
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/clients/:id → 200 with the created client', async () => {
            const res = await request(app.getHttpServer())
                .get(`/api/clients/${clientId}`)
                .set(auth())
                .expect(200);
            expect(res.body.id).toBe(clientId);
        });

        it('PATCH /api/clients/:id → 200 after update', async () => {
            const res = await request(app.getHttpServer())
                .patch(`/api/clients/${clientId}`)
                .set(auth())
                .send({ goal: 'Weight loss' })
                .expect(200);
            expect(res.body.goal).toBe('Weight loss');
        });

        it('GET /api/clients → 401 without token', async () => {
            await request(app.getHttpServer()).get('/api/clients').expect(401);
        });
    });

    // ── Workouts ────────────────────────────────────────────────────────────────

    describe('Workouts CRUD', () => {
        it('GET /api/workouts → 200 (array)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/workouts')
                .set(auth())
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/workouts/:id → 200 with the created workout', async () => {
            const res = await request(app.getHttpServer())
                .get(`/api/workouts/${workoutId}`)
                .set(auth())
                .expect(200);
            expect(res.body.id).toBe(workoutId);
        });

        it('PATCH /api/workouts/:id → 200 after update', async () => {
            const res = await request(app.getHttpServer())
                .patch(`/api/workouts/${workoutId}`)
                .set(auth())
                .send({ title: `Updated Workout ${S}` })
                .expect(200);
            expect(res.body.title).toBe(`Updated Workout ${S}`);
        });

        it('GET /api/workouts → 401 without token', async () => {
            await request(app.getHttpServer()).get('/api/workouts').expect(401);
        });
    });

    // ── Sessions ────────────────────────────────────────────────────────────────

    describe('Sessions CRUD', () => {
        it('GET /api/sessions → 200 (array)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/sessions')
                .set(auth())
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/sessions/:id → 200 with the created session', async () => {
            const res = await request(app.getHttpServer())
                .get(`/api/sessions/${sessionId}`)
                .set(auth())
                .expect(200);
            expect(res.body.id).toBe(sessionId);
        });

        it('POST /api/sessions/:id/toggle-complete → 201', async () => {
            await request(app.getHttpServer())
                .post(`/api/sessions/${sessionId}/toggle-complete`)
                .set(auth())
                .expect(201);
        });

        it('PATCH /api/sessions/:id/scope → 200 after update', async () => {
            const res = await request(app.getHttpServer())
                .patch(`/api/sessions/${sessionId}/scope`)
                .set(auth())
                .send({ scope: 'single', notes: 'Updated via smoke test' })
                .expect(200);
            expect(res.body.notes).toBe('Updated via smoke test');
        });

        it('GET /api/sessions → 401 without token', async () => {
            await request(app.getHttpServer()).get('/api/sessions').expect(401);
        });
    });

    // ── Evaluations ─────────────────────────────────────────────────────────────

    describe('Evaluations CRUD', () => {
        it('GET /api/evaluations → 200 (array)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/evaluations')
                .set(auth())
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/evaluations/:id → 200 with the created evaluation', async () => {
            const res = await request(app.getHttpServer())
                .get(`/api/evaluations/${evaluationId}`)
                .set(auth())
                .expect(200);
            expect(res.body.id).toBe(evaluationId);
        });

        it('PATCH /api/evaluations/:id → 200 after update', async () => {
            const res = await request(app.getHttpServer())
                .patch(`/api/evaluations/${evaluationId}`)
                .set(auth())
                .send({ notes: 'Updated via smoke test' })
                .expect(200);
            expect(res.body.notes).toBe('Updated via smoke test');
        });

        it('GET /api/evaluations → 401 without token', async () => {
            await request(app.getHttpServer()).get('/api/evaluations').expect(401);
        });
    });

    // ── Settings ────────────────────────────────────────────────────────────────

    describe('Settings', () => {
        it('GET /api/settings/language → 200 with { language }', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/settings/language')
                .set(auth())
                .expect(200);
            expect(res.body).toHaveProperty('language');
        });

        it('PATCH /api/settings/language → 200 sets language', async () => {
            const res = await request(app.getHttpServer())
                .patch('/api/settings/language')
                .set(auth())
                .send({ language: 'pt-BR' })
                .expect(200);
            expect(res.body.language).toBe('pt-BR');
        });

        it('GET /api/settings/ai-instructions → 200', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/settings/ai-instructions')
                .set(auth())
                .expect(200);
            expect(res.body).toHaveProperty('instructions');
        });

        it('PUT /api/settings/ai-instructions → 200', async () => {
            await request(app.getHttpServer())
                .put('/api/settings/ai-instructions')
                .set(auth())
                .send({ instructions: 'Smoke test instructions' })
                .expect(200);
        });

        it('GET /api/settings/work-hours → 200 with day schedule', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/settings/work-hours')
                .set(auth())
                .expect(200);
            expect(res.body).toHaveProperty('monday');
        });

        it('PUT /api/settings/work-hours → 200', async () => {
            const payload = {
                monday: { enabled: true, start: '08:00', end: '18:00' },
                tuesday: { enabled: true, start: '08:00', end: '18:00' },
                wednesday: { enabled: true, start: '08:00', end: '18:00' },
                thursday: { enabled: true, start: '08:00', end: '18:00' },
                friday: { enabled: true, start: '08:00', end: '18:00' },
                saturday: { enabled: false, start: '08:00', end: '12:00' },
                sunday: { enabled: false, start: '08:00', end: '12:00' },
                slotDurationMinutes: 60,
            };
            const res = await request(app.getHttpServer())
                .put('/api/settings/work-hours')
                .set(auth())
                .send(payload)
                .expect(200);
            expect(res.body.monday.start).toBe('08:00');
        });

        it('GET /api/settings/language → 401 without token', async () => {
            await request(app.getHttpServer()).get('/api/settings/language').expect(401);
        });
    });

    // ── Availability Blocks ─────────────────────────────────────────────────────

    describe('Availability Blocks', () => {
        it('GET /api/availability-blocks → 200 (array)', async () => {
            const start = new Date(Date.now()).toISOString();
            const end = new Date(Date.now() + 7 * 86_400_000).toISOString();
            const res = await request(app.getHttpServer())
                .get('/api/availability-blocks')
                .set(auth())
                .query({ start, end })
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('PATCH /api/availability-blocks/:id → 200 after update', async () => {
            await request(app.getHttpServer())
                .patch(`/api/availability-blocks/${availabilityBlockId}`)
                .set(auth())
                .send({ notes: 'Smoke test block' })
                .expect(200);
        });

        it('GET /api/availability-blocks → 401 without token', async () => {
            await request(app.getHttpServer())
                .get('/api/availability-blocks')
                .expect(401);
        });
    });

    // ── System Features ─────────────────────────────────────────────────────────

    describe('System Features', () => {
        it('GET /api/system-features/active → 200 (array)', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/system-features/active')
                .set(auth())
                .expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/system-features/active → 401 without token', async () => {
            await request(app.getHttpServer())
                .get('/api/system-features/active')
                .expect(401);
        });

        it('POST /api/system-features → 403 for non-admin user', async () => {
            await request(app.getHttpServer())
                .post('/api/system-features')
                .set(auth())
                .send({ key: 'smoke-feature', label: 'Smoke', description: 'test', active: true })
                .expect(403);
        });

        it('GET /api/system-features → 403 for non-admin user', async () => {
            await request(app.getHttpServer())
                .get('/api/system-features')
                .set(auth())
                .expect(403);
        });
    });

    // ── Cleanup CRUD (DELETE endpoints) ────────────────────────────────────────
    // Deletes are run last to preserve resource IDs for earlier read/update tests

    describe('DELETE endpoints', () => {
        it('DELETE /api/evaluations/:id → 204', async () => {
            await request(app.getHttpServer())
                .delete(`/api/evaluations/${evaluationId}`)
                .set(auth())
                .expect(204);
            evaluationId = ''; // prevent double-delete in afterAll
        });

        it('DELETE /api/sessions/:id → 204', async () => {
            await request(app.getHttpServer())
                .delete(`/api/sessions/${sessionId}`)
                .set(auth())
                .expect(204);
            sessionId = '';
        });

        it('DELETE /api/workouts/:id → 200 or 204', async () => {
            const res = await request(app.getHttpServer())
                .delete(`/api/workouts/${workoutId}`)
                .set(auth());
            expect([200, 204]).toContain(res.status);
            workoutId = '';
        });

        it('DELETE /api/availability-blocks/:id → 200 or 204', async () => {
            const res = await request(app.getHttpServer())
                .delete(`/api/availability-blocks/${availabilityBlockId}`)
                .set(auth());
            expect([200, 204]).toContain(res.status);
            availabilityBlockId = '';
        });

        it('DELETE /api/clients/:id → 204', async () => {
            await request(app.getHttpServer())
                .delete(`/api/clients/${clientId}`)
                .set(auth())
                .expect(204);
            clientId = '';
        });

        it('DELETE /api/plans/:id → 200 or 204', async () => {
            const res = await request(app.getHttpServer())
                .delete(`/api/plans/${planId}`)
                .set(auth());
            expect([200, 204]).toContain(res.status);
            planId = '';
        });
    });
});
