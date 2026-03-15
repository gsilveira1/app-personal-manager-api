import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { PlansService } from './plans.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PlansService', () => {
  let service: PlansService;
  let prisma: any;

  const userId = 'trainer-uuid-1';
  const planId = 'plan-uuid-1';

  const mockPlan = {
    id: planId,
    type: 'PRESENCIAL',
    name: 'Plano Básico',
    sessionsPerWeek: 3,
    durationMinutes: 60,
    price: 200,
    active: true,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    features: [],
  };

  beforeEach(async () => {
    prisma = {
      plan: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      planFeature: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create a plan tied to the trainer', async () => {
      prisma.plan.create.mockResolvedValue(mockPlan);

      const dto = { type: 'PRESENCIAL', name: 'Plano Básico', sessionsPerWeek: 3, price: 200 };
      const result = await service.create(userId, dto as any);

      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Plano Básico', userId }),
        }),
      );
      expect(result.id).toBe(planId);
    });

    it('should create plan with featureIds', async () => {
      prisma.plan.create.mockResolvedValue(mockPlan);

      const dto = {
        type: 'PRESENCIAL',
        name: 'Plano Premium',
        sessionsPerWeek: 3,
        price: 400,
        featureIds: ['feature-1', 'feature-2'],
      };
      await service.create(userId, dto as any);

      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            features: {
              create: [{ featureId: 'feature-1' }, { featureId: 'feature-2' }],
            },
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return plans with client count and features', async () => {
      prisma.plan.findMany.mockResolvedValue([{ ...mockPlan, _count: { clients: 5 } }]);

      const result = await service.findAll(userId);

      expect(prisma.plan.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: {
          features: { include: { feature: true } },
          _count: { select: { clients: true } },
        },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return plan when found and owned', async () => {
      prisma.plan.findUnique.mockResolvedValue(mockPlan);

      const result = await service.findOne(userId, planId);
      expect(result.id).toBe(planId);
    });

    it('should throw NotFoundException when plan does not exist', async () => {
      prisma.plan.findUnique.mockResolvedValue(null);
      await expect(service.findOne(userId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when plan belongs to another user', async () => {
      prisma.plan.findUnique.mockResolvedValue({ ...mockPlan, userId: 'other-user' });
      await expect(service.findOne(userId, planId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update plan after ownership check', async () => {
      prisma.plan.findUnique.mockResolvedValue(mockPlan);
      prisma.plan.update.mockResolvedValue({ ...mockPlan, price: 250 });

      const result = await service.update(userId, planId, { price: 250 });
      expect(result.price).toBe(250);
    });

    it('should replace features when featureIds provided', async () => {
      prisma.plan.findUnique.mockResolvedValue(mockPlan);
      prisma.planFeature.deleteMany.mockResolvedValue({ count: 1 });
      prisma.plan.update.mockResolvedValue({ ...mockPlan, features: [] });

      await service.update(userId, planId, { featureIds: ['feature-new'] });

      expect(prisma.planFeature.deleteMany).toHaveBeenCalledWith({
        where: { planId },
      });
      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            features: { create: [{ featureId: 'feature-new' }] },
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('should delete plan after ownership check', async () => {
      prisma.plan.findUnique.mockResolvedValue(mockPlan);
      prisma.plan.delete.mockResolvedValue(mockPlan);

      await service.remove(userId, planId);
      expect(prisma.plan.delete).toHaveBeenCalledWith({ where: { id: planId } });
    });
  });

  describe('findPublicByTrainer', () => {
    it('should separate plans by type and include features', async () => {
      const presencial = {
        id: '1', type: 'PRESENCIAL', name: 'P1', sessionsPerWeek: 3,
        durationMinutes: 60, price: 200,
        features: [{ feature: { key: 'ai_bot', name: 'AI Bot' } }],
      };
      const consultoria = {
        id: '2', type: 'CONSULTORIA', name: 'C1', sessionsPerWeek: 1,
        durationMinutes: null, price: 150,
        features: [],
      };
      prisma.plan.findMany.mockResolvedValue([presencial, consultoria]);

      const result = await service.findPublicByTrainer(userId);

      expect(result.presencial).toHaveLength(1);
      expect(result.consultoria).toHaveLength(1);
      expect(result.presencial[0].sessionsPerMonth).toBe(12);
      expect(result.presencial[0].features).toEqual([{ key: 'ai_bot', name: 'AI Bot' }]);
    });

    it('should return empty arrays when no active plans', async () => {
      prisma.plan.findMany.mockResolvedValue([]);

      const result = await service.findPublicByTrainer(userId);
      expect(result).toEqual({ presencial: [], consultoria: [] });
    });
  });
});
