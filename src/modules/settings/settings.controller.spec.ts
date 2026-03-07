import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { RequestWithUser } from '../../types/global';

const mockSettingsService = {
  getAiInstructions: jest.fn(),
  updateAiInstructions: jest.fn(),
  getLanguage: jest.fn(),
  updateLanguage: jest.fn(),
};

const mockRequest = (userId: string): RequestWithUser =>
  ({ user: { userId, email: 'test@example.com' } } as RequestWithUser);

describe('SettingsController', () => {
  let controller: SettingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: mockSettingsService }],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    jest.clearAllMocks();
  });

  // ─── GET /language ─────────────────────────────────────────────────────────

  describe('getLanguage', () => {
    it('returns service result for authenticated user', async () => {
      mockSettingsService.getLanguage.mockResolvedValue({ language: 'en' });

      const result = await controller.getLanguage(mockRequest('u1'));
      expect(result).toEqual({ language: 'en' });
    });

    it('delegates correct userId to service', async () => {
      mockSettingsService.getLanguage.mockResolvedValue({ language: 'pt-BR' });

      await controller.getLanguage(mockRequest('user-abc'));
      expect(mockSettingsService.getLanguage).toHaveBeenCalledWith('user-abc');
    });
  });

  // ─── PATCH /language ───────────────────────────────────────────────────────

  describe('updateLanguage', () => {
    it('returns updated language for valid locale', async () => {
      mockSettingsService.updateLanguage.mockResolvedValue({ language: 'pt-BR' });

      const result = await controller.updateLanguage(mockRequest('u1'), { language: 'pt-BR' });
      expect(result).toEqual({ language: 'pt-BR' });
    });

    it('delegates correct userId and language to service', async () => {
      mockSettingsService.updateLanguage.mockResolvedValue({ language: 'pt-BR' });

      await controller.updateLanguage(mockRequest('user-xyz'), { language: 'pt-BR' });
      expect(mockSettingsService.updateLanguage).toHaveBeenCalledWith('user-xyz', 'pt-BR');
    });
  });
});
