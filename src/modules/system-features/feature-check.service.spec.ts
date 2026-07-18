import { Test, TestingModule } from '@nestjs/testing';

import { FeatureCheckService } from './feature-check.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeatureCheckService', () => {
  let service: FeatureCheckService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      client: {
        findUnique: jest.fn(),
      },
      planFeature: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureCheckService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FeatureCheckService>(FeatureCheckService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return false when client has no plan', async () => {
    prisma.client.findUnique.mockResolvedValue({ planId: null });

    const result = await service.hasFeature('client-1', 'ai_whatsapp_bot');
    expect(result).toBe(false);
    expect(prisma.planFeature.findFirst).not.toHaveBeenCalled();
  });

  it('should return false when client does not exist', async () => {
    prisma.client.findUnique.mockResolvedValue(null);

    const result = await service.hasFeature('non-existent', 'ai_whatsapp_bot');
    expect(result).toBe(false);
  });

  it('should return true when plan has the active feature', async () => {
    prisma.client.findUnique.mockResolvedValue({ planId: 'plan-1' });
    prisma.planFeature.findFirst.mockResolvedValue({
      planId: 'plan-1',
      featureId: 'feature-1',
    });

    const result = await service.hasFeature('client-1', 'ai_whatsapp_bot');
    expect(result).toBe(true);
  });

  it('should return false when plan does not have the feature', async () => {
    prisma.client.findUnique.mockResolvedValue({ planId: 'plan-1' });
    prisma.planFeature.findFirst.mockResolvedValue(null);

    const result = await service.hasFeature('client-1', 'nonexistent_feature');
    expect(result).toBe(false);
  });

  it('should check that feature is active', async () => {
    prisma.client.findUnique.mockResolvedValue({ planId: 'plan-1' });
    prisma.planFeature.findFirst.mockResolvedValue(null);

    await service.hasFeature('client-1', 'ai_whatsapp_bot');

    expect(prisma.planFeature.findFirst).toHaveBeenCalledWith({
      where: {
        planId: 'plan-1',
        feature: {
          key: 'ai_whatsapp_bot',
          isActive: true,
        },
      },
    });
  });
});
