import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeatureCheckService {
  constructor(private prisma: PrismaService) {}

  /**
   * Checks whether a client's plan includes a specific system feature.
   * Returns false if the client has no plan or the feature is inactive/missing.
   */
  async hasFeature(clientId: string, featureKey: string): Promise<boolean> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { planId: true },
    });

    if (!client?.planId) return false;

    const planFeature = await this.prisma.planFeature.findFirst({
      where: {
        planId: client.planId,
        feature: {
          key: featureKey,
          isActive: true,
        },
      },
    });

    return planFeature !== null;
  }
}
