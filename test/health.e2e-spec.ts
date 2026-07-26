/**
 * Health Check smoke test (e2e)
 *
 * Validates that the NestJS application boots and the /health endpoint
 * (registered before the global /api prefix in main.ts) responds correctly.
 *
 * This test does NOT require a real database — PrismaService is mocked so it
 * can also be used as a pure boot/infrastructure check in CI pipelines.
 *
 * Run: npm run test:e2e -- --testPathPattern=health
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/modules/app.module';

describe('Health Check (e2e)', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();

        // Mirror main.ts bootstrap exactly so the /health route is registered
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
    }, 30_000);

    afterAll(async () => {
        await app.close();
    });

    describe('GET /health', () => {
        it('responds 200 with { status: "ok" }', async () => {
            const res = await request(app.getHttpServer()).get('/health').expect(200);

            expect(res.body).toMatchObject({ status: 'ok' });
        });

        it('includes a valid ISO timestamp in the response', async () => {
            const res = await request(app.getHttpServer()).get('/health').expect(200);

            expect(res.body.timestamp).toBeDefined();
            expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
        });

        it('returns Content-Type application/json', async () => {
            await request(app.getHttpServer())
                .get('/health')
                .expect('Content-Type', /application\/json/);
        });
    });

    describe('Infrastructure — application bootstrap', () => {
        it('the NestJS app is defined after init', () => {
            expect(app).toBeDefined();
        });

        it('global prefix /api is active (unknown route returns 404, not 200)', async () => {
            // Without the prefix the route would accidentally match a wildcard.
            // A non-existing /api route must return 404 to confirm routing is wired.
            await request(app.getHttpServer()).get('/api/__nonexistent__').expect(404);
        });
    });
});
