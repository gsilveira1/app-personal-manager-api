import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { EvaluationsService } from './evaluations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EvaluationsService', () => {
  let service: EvaluationsService;
  let prisma: any;

  const userId = 'trainer-uuid-1';
  const evaluationId = 'eval-uuid-1';
  const clientId = 'client-uuid-1';

  const mockClient = { id: clientId, userId, name: 'Maria' };
  const mockEvaluation = {
    id: evaluationId,
    clientId,
    date: new Date('2025-02-01'),
    weight: 65,
    height: 170,
    bodyFatPercentage: 22,
    leanMass: null,
    notes: null,
    perimeters: null,
    skinfolds: null,
    client: mockClient,
  };

  beforeEach(async () => {
    prisma = {
      evaluation: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      client: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EvaluationsService>(EvaluationsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create evaluation for owned client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.evaluation.create.mockResolvedValue(mockEvaluation);

      const dto = { clientId, date: '2025-02-01', weight: 65, height: 170, bodyFatPercentage: 22 };
      const result = await service.create(userId, dto as any);

      expect(result.id).toBe(evaluationId);
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.create(userId, { clientId: 'non-existent', date: '2025-02-01', weight: 65 } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when client belongs to another user', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, userId: 'other-user' });

      await expect(
        service.create(userId, { clientId, date: '2025-02-01', weight: 65 } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should handle perimeters and skinfolds JSON', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.evaluation.create.mockResolvedValue(mockEvaluation);

      const dto = {
        clientId,
        date: '2025-02-01',
        weight: 65,
        perimeters: { waist: 75, hip: 95 },
        skinfolds: { triceps: 12, subscapular: 14 },
      };
      await service.create(userId, dto as any);

      expect(prisma.evaluation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          perimeters: { waist: 75, hip: 95 },
          skinfolds: { triceps: 12, subscapular: 14 },
        }),
      });
    });

    it('should handle empty perimeters/skinfolds (omit from data)', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.evaluation.create.mockResolvedValue(mockEvaluation);

      const dto = { clientId, date: '2025-02-01', weight: 65, perimeters: {}, skinfolds: {} };
      await service.create(userId, dto as any);

      const callData = prisma.evaluation.create.mock.calls[0][0].data;
      expect(callData.perimeters).toBeUndefined();
      expect(callData.skinfolds).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('should return evaluations filtered via client.userId', async () => {
      prisma.evaluation.findMany.mockResolvedValue([mockEvaluation]);

      const result = await service.findAll(userId);

      expect(prisma.evaluation.findMany).toHaveBeenCalledWith({
        where: { client: { userId } },
        include: { client: { select: { name: true, avatar: true } } },
        orderBy: { date: 'desc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return evaluation when owned', async () => {
      prisma.evaluation.findUnique.mockResolvedValue(mockEvaluation);

      const result = await service.findOne(userId, evaluationId);
      expect(result.id).toBe(evaluationId);
    });

    it('should throw NotFoundException when evaluation does not exist', async () => {
      prisma.evaluation.findUnique.mockResolvedValue(null);
      await expect(service.findOne(userId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when ownership check fails (via client.userId)', async () => {
      prisma.evaluation.findUnique.mockResolvedValue({
        ...mockEvaluation,
        client: { ...mockClient, userId: 'other-user' },
      });
      await expect(service.findOne(userId, evaluationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update evaluation with JSON fields', async () => {
      prisma.evaluation.findUnique.mockResolvedValue(mockEvaluation);
      prisma.evaluation.update.mockResolvedValue({ ...mockEvaluation, weight: 64 });

      const result = await service.update(userId, evaluationId, {
        weight: 64,
        perimeters: { waist: 73 },
      } as any);

      expect(prisma.evaluation.update).toHaveBeenCalledWith({
        where: { id: evaluationId },
        data: expect.objectContaining({ weight: 64, perimeters: { waist: 73 } }),
      });
    });
  });

  describe('remove', () => {
    it('should delete evaluation after ownership check', async () => {
      prisma.evaluation.findUnique.mockResolvedValue(mockEvaluation);
      prisma.evaluation.delete.mockResolvedValue(mockEvaluation);

      await service.remove(userId, evaluationId);
      expect(prisma.evaluation.delete).toHaveBeenCalledWith({ where: { id: evaluationId } });
    });
  });
});
