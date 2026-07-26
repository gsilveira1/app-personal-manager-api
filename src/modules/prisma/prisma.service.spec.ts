/**
 * Unit tests for PrismaService
 *
 * Validates that the service wires up the Prisma connection lifecycle hooks
 * correctly ($connect on init, $disconnect on destroy).
 *
 * Uses constructor-level mocking so no real database connection is attempted.
 *
 * Run: npm test -- --testPathPattern=prisma.service
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

// Mock the upstream Prisma and pg drivers so the unit test runs without a DB.
// IMPORTANT: PrismaClient must be mocked as a class (not a plain object factory)
// so that `PrismaService extends PrismaClient` preserves the prototype chain.
// If a plain object is returned from jest.fn().mockImplementation(), the `super()`
// call inside PrismaService replaces the `this` reference with the mock object,
// making PrismaService methods (onModuleInit, onModuleDestroy) unreachable.
jest.mock('@prisma/client', () => {
    class MockPrismaClient {
        $connect = jest.fn().mockResolvedValue(undefined);
        $disconnect = jest.fn().mockResolvedValue(undefined);
        constructor(_options?: unknown) {}
    }
    return { PrismaClient: MockPrismaClient };
});

jest.mock('@prisma/adapter-pg', () => {
    return {
        PrismaPg: jest.fn().mockImplementation(() => ({})),
    };
});

jest.mock('pg', () => {
    return {
        Pool: jest.fn().mockImplementation(() => ({})),
    };
});

describe('PrismaService', () => {
    let service: PrismaService;

    beforeEach(async () => {
        // Set a dummy DATABASE_URL so the constructor doesn't fail on undefined
        process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

        const module: TestingModule = await Test.createTestingModule({
            providers: [PrismaService],
        }).compile();

        service = module.get<PrismaService>(PrismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
        delete process.env.DATABASE_URL;
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('onModuleInit', () => {
        it('calls $connect when the module initializes', async () => {
            const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue();

            await service.onModuleInit();

            expect(connectSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('onModuleDestroy', () => {
        it('calls $disconnect when the module is destroyed', async () => {
            const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue();

            await service.onModuleDestroy();

            expect(disconnectSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('lifecycle order', () => {
        it('connects before disconnect', async () => {
            const calls: string[] = [];
            jest.spyOn(service, '$connect').mockImplementation(async () => {
                calls.push('connect');
            });
            jest.spyOn(service, '$disconnect').mockImplementation(async () => {
                calls.push('disconnect');
            });

            await service.onModuleInit();
            await service.onModuleDestroy();

            expect(calls).toEqual(['connect', 'disconnect']);
        });
    });
});
