import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';

import { ClientsService } from './clients.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: any;

  const userId = 'trainer-uuid-1';
  const clientId = 'client-uuid-1';

  const mockClient = {
    id: clientId,
    name: 'Maria Santos',
    email: 'maria@example.com',
    phone: '53999001122',
    status: 'Active',
    type: 'In-Person',
    userId,
    planId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      client: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create a client with userId', async () => {
      const dto = { name: 'Maria Santos', email: 'maria@example.com', phone: '53999001122', type: 'In-Person' };
      prisma.client.create.mockResolvedValue({ ...mockClient });

      const result = await service.create(userId, dto as any);

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId, name: 'Maria Santos' }),
      });
      expect(result.name).toBe('Maria Santos');
    });

    it('should handle medicalHistory JSON correctly', async () => {
      const dto = {
        name: 'Maria', email: 'maria@example.com', phone: '53999001122', type: 'In-Person',
        medicalHistory: { objective: ['Saúde'], hasHeartDisease: false },
      };
      prisma.client.create.mockResolvedValue({ ...mockClient, medicalHistory: dto.medicalHistory });

      await service.create(userId, dto as any);

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          medicalHistory: { objective: ['Saúde'], hasHeartDisease: false },
        }),
      });
    });

    it('should throw ConflictException on duplicate email (P2002)', async () => {
      prisma.client.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create(userId, { name: 'Test', email: 'dup@example.com', phone: '123', type: 'Online' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-P2002 errors', async () => {
      const error = new Error('DB connection lost');
      prisma.client.create.mockRejectedValue(error);

      await expect(
        service.create(userId, { name: 'Test', email: 'test@example.com', phone: '123', type: 'Online' } as any),
      ).rejects.toThrow('DB connection lost');
    });
  });

  describe('findAll', () => {
    it('should return clients filtered by userId, ordered by name', async () => {
      prisma.client.findMany.mockResolvedValue([mockClient]);

      const result = await service.findAll(userId);

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: { plan: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no clients', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      const result = await service.findAll(userId);
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return client with plan and workouts', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, plan: null, workouts: [] });

      const result = await service.findOne(userId, clientId);
      expect(result.id).toBe(clientId);
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, userId: 'other-user' });

      await expect(service.findOne(userId, clientId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update client after ownership check', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, plan: null, workouts: [] });
      prisma.client.update.mockResolvedValue({ ...mockClient, name: 'Maria Updated' });

      const result = await service.update(userId, clientId, { name: 'Maria Updated' } as any);

      expect(result.name).toBe('Maria Updated');
    });

    it('should throw ForbiddenException when updating another user client', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, userId: 'other-user' });

      await expect(service.update(userId, clientId, { name: 'Test' } as any)).rejects.toThrow(ForbiddenException);
    });

    it('should handle medicalHistory update correctly', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, plan: null, workouts: [] });
      prisma.client.update.mockResolvedValue(mockClient);

      const medHistory = { objective: ['Hipertrofia'], smoker: false };
      await service.update(userId, clientId, { medicalHistory: medHistory } as any);

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: clientId },
        data: expect.objectContaining({ medicalHistory: medHistory }),
      });
    });
  });

  describe('remove', () => {
    it('should delete client after ownership check', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, plan: null, workouts: [] });
      prisma.client.delete.mockResolvedValue(mockClient);

      await service.remove(userId, clientId);

      expect(prisma.client.delete).toHaveBeenCalledWith({ where: { id: clientId } });
    });

    it('should throw ForbiddenException when deleting another user client', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, userId: 'other-user' });

      await expect(service.remove(userId, clientId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findLeads', () => {
    it('should return only Lead status clients ordered by createdAt desc', async () => {
      const leadClient = { ...mockClient, status: 'Lead' };
      prisma.client.findMany.mockResolvedValue([leadClient]);

      const result = await service.findLeads(userId);

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { userId, status: 'Lead' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no leads', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      const result = await service.findLeads(userId);
      expect(result).toEqual([]);
    });
  });

  describe('convertLead', () => {
    it('should update client status to Active', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, status: 'Lead', plan: null, workouts: [] });
      prisma.client.update.mockResolvedValue({ ...mockClient, status: 'Active' });

      const result = await service.convertLead(userId, clientId);

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: clientId },
        data: { status: 'Active' },
      });
      expect(result.status).toBe('Active');
    });

    it('should optionally assign planId when converting', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, status: 'Lead', plan: null, workouts: [] });
      prisma.client.update.mockResolvedValue({ ...mockClient, status: 'Active', planId: 'plan-uuid' });

      await service.convertLead(userId, clientId, 'plan-uuid');

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: clientId },
        data: { status: 'Active', planId: 'plan-uuid' },
      });
    });

    it('should throw NotFoundException for non-existent client', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(service.convertLead(userId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for unauthorized access', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, userId: 'other-user' });

      await expect(service.convertLead(userId, clientId)).rejects.toThrow(ForbiddenException);
    });
  });
});
