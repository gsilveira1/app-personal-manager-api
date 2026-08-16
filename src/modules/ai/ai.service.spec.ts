import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      ARRAY: 'ARRAY',
    },
  };
});

describe('AiService & AiController', () => {
  let service: AiService;
  let controller: AiController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        AiService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'GEMINI_API_KEY') return 'test-key';
              return null;
            },
          },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    controller = module.get<AiController>(AiController);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(controller).toBeDefined();
  });

  describe('generateWorkoutPlan', () => {
    it('should generate structured workout plan JSON', async () => {
      const mockResult = {
        title: 'Treino de Hipertrofia',
        description: 'Foco em membros superiores',
        exercises: [{ name: 'Supino Reto', sets: 4, reps: '10-12', notes: 'Carga moderada' }],
        tags: ['Hipertrofia', 'Peito'],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult),
      });

      const dto = {
        clientName: 'Maria Silva',
        goal: 'Hipertrofia',
        experienceLevel: 'Intermediário',
        daysPerWeek: 4,
      };

      const result = await controller.generateWorkoutPlan(dto);
      expect(result).toEqual(mockResult);
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when AI returns empty text', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: '' });

      const dto = {
        clientName: 'Maria Silva',
        goal: 'Emagrecimento',
        experienceLevel: 'Iniciante',
        daysPerWeek: 3,
      };

      await expect(controller.generateWorkoutPlan(dto)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('generateWorkoutInsights', () => {
    it('should generate structured workout insights JSON', async () => {
      const mockResult = {
        insights: [
          {
            suggestion: { name: 'Agachamento Búlgaro', sets: 3, reps: '10-12', notes: 'Estabilidade' },
            reason: 'Fortalecer quadríceps respeitando sensibilidade no joelho',
          },
        ],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult),
      });

      const dto = {
        client: { id: 'c1', name: 'Maria Silva', goal: 'Emagrecimento' },
        archivedPlans: [],
      };

      const result = await controller.generateWorkoutInsights(dto);
      expect(result).toEqual(mockResult);
      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });
});
