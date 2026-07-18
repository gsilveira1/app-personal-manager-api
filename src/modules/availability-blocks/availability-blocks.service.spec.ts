import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { AvailabilityBlocksService } from './availability-blocks.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AvailabilityBlocksService', () => {
  let service: AvailabilityBlocksService;
  let prisma: any;

  const userId = 'trainer-uuid-1';

  const mockBlock = {
    id: 'block-1',
    title: 'Almoço',
    rrule: null,
    timezone: 'America/Sao_Paulo',
    dtstart: new Date('2025-01-15T12:00:00Z'),
    dtend: new Date('2025-01-15T13:00:00Z'),
    notes: null,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      availabilityBlock: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvailabilityBlocksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AvailabilityBlocksService>(AvailabilityBlocksService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create a one-off availability block', async () => {
      prisma.availabilityBlock.create.mockResolvedValue(mockBlock);

      const result = await service.create(userId, {
        title: 'Almoço',
        dtstart: '2025-01-15T12:00:00Z',
        dtend: '2025-01-15T13:00:00Z',
      });

      expect(prisma.availabilityBlock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Almoço',
          userId,
          rrule: null,
        }),
      });
      expect(result.id).toBe('block-1');
    });

    it('should create a recurring availability block', async () => {
      const recurringBlock = { ...mockBlock, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' };
      prisma.availabilityBlock.create.mockResolvedValue(recurringBlock);

      const result = await service.create(userId, {
        title: 'Almoço',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        dtstart: '2025-01-06T12:00:00Z',
        dtend: '2025-01-06T13:00:00Z',
      });

      expect(prisma.availabilityBlock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        }),
      });
      expect(result.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    });
  });

  describe('update', () => {
    it('should update a block owned by the user', async () => {
      prisma.availabilityBlock.findUnique.mockResolvedValue(mockBlock);
      prisma.availabilityBlock.update.mockResolvedValue({ ...mockBlock, title: 'Pausa' });

      const result = await service.update(userId, 'block-1', { title: 'Pausa' });

      expect(result.title).toBe('Pausa');
    });

    it('should throw NotFoundException when block does not exist', async () => {
      prisma.availabilityBlock.findUnique.mockResolvedValue(null);

      await expect(
        service.update(userId, 'non-existent', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when block belongs to another user', async () => {
      prisma.availabilityBlock.findUnique.mockResolvedValue({
        ...mockBlock,
        userId: 'other-user',
      });

      await expect(
        service.update(userId, 'block-1', { title: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('should delete a block owned by the user', async () => {
      prisma.availabilityBlock.findUnique.mockResolvedValue(mockBlock);
      prisma.availabilityBlock.delete.mockResolvedValue(mockBlock);

      await service.remove(userId, 'block-1');

      expect(prisma.availabilityBlock.delete).toHaveBeenCalledWith({
        where: { id: 'block-1' },
      });
    });

    it('should throw NotFoundException when block does not exist', async () => {
      prisma.availabilityBlock.findUnique.mockResolvedValue(null);

      await expect(service.remove(userId, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when block belongs to another user', async () => {
      prisma.availabilityBlock.findUnique.mockResolvedValue({
        ...mockBlock,
        userId: 'other-user',
      });

      await expect(service.remove(userId, 'block-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('materializeBlocksForRange', () => {
    it('should return one-off blocks that overlap the range', async () => {
      prisma.availabilityBlock.findMany.mockResolvedValue([mockBlock]);

      const result = await service.materializeBlocksForRange(
        userId,
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-01-31T23:59:59Z'),
      );

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Almoço');
      expect(result[0].isRecurring).toBe(false);
      expect(result[0].blockId).toBe('block-1');
    });

    it('should expand recurring blocks via RRULE', async () => {
      const recurringBlock = {
        ...mockBlock,
        id: 'block-recurring',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        dtstart: new Date('2025-01-06T12:00:00Z'), // Monday
        dtend: new Date('2025-01-06T13:00:00Z'),
      };
      prisma.availabilityBlock.findMany.mockResolvedValue([recurringBlock]);

      const result = await service.materializeBlocksForRange(
        userId,
        new Date('2025-01-06T00:00:00Z'),
        new Date('2025-01-10T23:59:59Z'), // Mon-Fri
      );

      expect(result).toHaveLength(5);
      expect(result.every((b) => b.isRecurring)).toBe(true);
      expect(result.every((b) => b.title === 'Almoço')).toBe(true);
    });

    it('should return empty array when no blocks exist', async () => {
      prisma.availabilityBlock.findMany.mockResolvedValue([]);

      const result = await service.materializeBlocksForRange(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31'),
      );

      expect(result).toEqual([]);
    });

    it('should skip malformed RRULE strings gracefully', async () => {
      const badBlock = {
        ...mockBlock,
        rrule: 'TOTALLY_INVALID',
        dtstart: new Date('2025-01-06T12:00:00Z'),
        dtend: new Date('2025-01-06T13:00:00Z'),
      };
      prisma.availabilityBlock.findMany.mockResolvedValue([badBlock]);

      const result = await service.materializeBlocksForRange(
        userId,
        new Date('2025-01-01'),
        new Date('2025-01-31'),
      );

      expect(result).toEqual([]);
    });
  });
});
