import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  userSetting: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    jest.clearAllMocks();
  });

  // ─── getLanguage ───────────────────────────────────────────────────────────

  describe('getLanguage', () => {
    it('returns stored language when row exists', async () => {
      mockPrismaService.userSetting.findUnique.mockResolvedValue({
        userId: 'u1',
        key: 'preferred_language',
        value: 'pt-BR',
      });

      const result = await service.getLanguage('u1');
      expect(result).toEqual({ language: 'pt-BR' });
    });

    it('returns "pt-BR" as default when no row exists', async () => {
      mockPrismaService.userSetting.findUnique.mockResolvedValue(null);

      const result = await service.getLanguage('u1');
      expect(result).toEqual({ language: 'pt-BR' });
    });

    it('calls findUnique with correct composite key', async () => {
      mockPrismaService.userSetting.findUnique.mockResolvedValue(null);

      await service.getLanguage('user-123');
      expect(mockPrismaService.userSetting.findUnique).toHaveBeenCalledWith({
        where: { userId_key: { userId: 'user-123', key: 'preferred_language' } },
      });
    });

    it('bubbles up Prisma errors without masking', async () => {
      const dbError = new Error('DB connection failed');
      mockPrismaService.userSetting.findUnique.mockRejectedValue(dbError);

      await expect(service.getLanguage('u1')).rejects.toThrow('DB connection failed');
    });
  });

  // ─── updateLanguage ────────────────────────────────────────────────────────

  describe('updateLanguage', () => {
    it('upserts with create payload on first write', async () => {
      mockPrismaService.userSetting.upsert.mockResolvedValue({
        userId: 'u1',
        key: 'preferred_language',
        value: 'es',
      });

      const result = await service.updateLanguage('u1', 'es');

      expect(mockPrismaService.userSetting.upsert).toHaveBeenCalledWith({
        where: { userId_key: { userId: 'u1', key: 'preferred_language' } },
        update: { value: 'es' },
        create: { userId: 'u1', key: 'preferred_language', value: 'es' },
      });
      expect(result).toEqual({ language: 'es' });
    });

    it('upserts with update payload for existing row', async () => {
      mockPrismaService.userSetting.upsert.mockResolvedValue({
        userId: 'u1',
        key: 'preferred_language',
        value: 'pt-BR',
      });

      const result = await service.updateLanguage('u1', 'pt-BR');

      expect(result).toEqual({ language: 'pt-BR' });
      expect(mockPrismaService.userSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { value: 'pt-BR' } }),
      );
    });

    it('is idempotent — calling twice with same value returns same result', async () => {
      mockPrismaService.userSetting.upsert.mockResolvedValue({
        userId: 'u1',
        key: 'preferred_language',
        value: 'en',
      });

      const first = await service.updateLanguage('u1', 'en');
      const second = await service.updateLanguage('u1', 'en');

      expect(first).toEqual({ language: 'en' });
      expect(second).toEqual({ language: 'en' });
      expect(mockPrismaService.userSetting.upsert).toHaveBeenCalledTimes(2);
    });
  });
});
