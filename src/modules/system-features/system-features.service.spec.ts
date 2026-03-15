import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';

import { SystemFeaturesService } from './system-features.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SystemFeaturesService', () => {
  let service: SystemFeaturesService;
  let prisma: any;

  const featureId = 'feature-uuid-1';
  const mockFeature = {
    id: featureId,
    key: 'ai_whatsapp_bot',
    name: 'Bot WhatsApp com IA',
    description: 'Chatbot inteligente',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      systemFeature: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemFeaturesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SystemFeaturesService>(SystemFeaturesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create a new system feature', async () => {
      prisma.systemFeature.findUnique.mockResolvedValue(null);
      prisma.systemFeature.create.mockResolvedValue(mockFeature);

      const result = await service.create({
        key: 'ai_whatsapp_bot',
        name: 'Bot WhatsApp com IA',
        description: 'Chatbot inteligente',
      });

      expect(result.key).toBe('ai_whatsapp_bot');
      expect(prisma.systemFeature.create).toHaveBeenCalled();
    });

    it('should throw ConflictException when key already exists', async () => {
      prisma.systemFeature.findUnique.mockResolvedValue(mockFeature);

      await expect(
        service.create({ key: 'ai_whatsapp_bot', name: 'Duplicate' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return all features with plan count', async () => {
      prisma.systemFeature.findMany.mockResolvedValue([
        { ...mockFeature, _count: { plans: 3 } },
      ]);

      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(prisma.systemFeature.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { _count: { select: { plans: true } } },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return feature when found', async () => {
      prisma.systemFeature.findUnique.mockResolvedValue({
        ...mockFeature,
        _count: { plans: 2 },
      });

      const result = await service.findOne(featureId);
      expect(result.id).toBe(featureId);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.systemFeature.findUnique.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllActive', () => {
    it('should return only active features', async () => {
      prisma.systemFeature.findMany.mockResolvedValue([mockFeature]);

      const result = await service.findAllActive();
      expect(result).toHaveLength(1);
      expect(prisma.systemFeature.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe('update', () => {
    it('should update feature after existence check', async () => {
      prisma.systemFeature.findUnique.mockResolvedValue({
        ...mockFeature,
        _count: { plans: 0 },
      });
      prisma.systemFeature.update.mockResolvedValue({
        ...mockFeature,
        isActive: false,
      });

      const result = await service.update(featureId, { isActive: false });
      expect(result.isActive).toBe(false);
    });
  });

  describe('remove', () => {
    it('should delete feature after existence check', async () => {
      prisma.systemFeature.findUnique.mockResolvedValue({
        ...mockFeature,
        _count: { plans: 0 },
      });
      prisma.systemFeature.delete.mockResolvedValue(mockFeature);

      await service.remove(featureId);
      expect(prisma.systemFeature.delete).toHaveBeenCalledWith({
        where: { id: featureId },
      });
    });
  });
});
