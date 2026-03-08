import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: any;
  let configService: any;

  const trainerId = 'trainer-uuid-1';

  beforeEach(async () => {
    prisma = {
      client: {
        create: jest.fn(),
      },
    };

    configService = {
      get: jest.fn().mockReturnValue(trainerId),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create a lead with interest "presencial" mapped to "In-Person"', async () => {
      const dto = { name: 'Carlos', email: 'carlos@example.com', phone: '53999001122', interest: 'presencial' as const };
      prisma.client.create.mockResolvedValue({ id: 'lead-1', ...dto, type: 'In-Person', status: 'Lead' });

      const result = await service.create(dto);

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Carlos',
          email: 'carlos@example.com',
          type: 'In-Person',
          status: 'Lead',
          userId: trainerId,
        }),
      });
    });

    it('should map interest "online" to type "Online"', async () => {
      const dto = { name: 'Ana', email: 'ana@example.com', phone: '123', interest: 'online' as const };
      prisma.client.create.mockResolvedValue({ id: 'lead-2' });

      await service.create(dto);

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'Online' }),
      });
    });

    it('should map interest "ambos" to type "Online"', async () => {
      const dto = { name: 'Pedro', email: 'pedro@example.com', phone: '123', interest: 'ambos' as const };
      prisma.client.create.mockResolvedValue({ id: 'lead-3' });

      await service.create(dto);

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'Online' }),
      });
    });

    it('should store message as notes', async () => {
      const dto = { name: 'Carlos', email: 'carlos@example.com', phone: '123', interest: 'presencial' as const, message: 'Quero começar!' };
      prisma.client.create.mockResolvedValue({ id: 'lead-4' });

      await service.create(dto);

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ notes: 'Quero começar!' }),
      });
    });

    it('should set notes to null when message is absent', async () => {
      const dto = { name: 'Carlos', email: 'carlos@example.com', phone: '123', interest: 'presencial' as const };
      prisma.client.create.mockResolvedValue({ id: 'lead-5' });

      await service.create(dto);

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ notes: null }),
      });
    });

    it('should throw Error when TRAINER_USER_ID is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      const dto = { name: 'Carlos', email: 'carlos@example.com', phone: '123', interest: 'presencial' as const };

      await expect(service.create(dto)).rejects.toThrow('TRAINER_USER_ID is not configured');
    });

    it('should throw ConflictException on duplicate email (P2002)', async () => {
      const dto = { name: 'Carlos', email: 'carlos@example.com', phone: '123', interest: 'presencial' as const };
      prisma.client.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-P2002 errors', async () => {
      const dto = { name: 'Carlos', email: 'carlos@example.com', phone: '123', interest: 'presencial' as const };
      prisma.client.create.mockRejectedValue(new Error('DB error'));

      await expect(service.create(dto)).rejects.toThrow('DB error');
    });
  });
});
