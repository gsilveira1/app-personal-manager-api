import { Injectable } from "@nestjs/common";

import { NOT_DELETED } from "../../../common/prisma/soft-delete";
import { PlanFeatureKey } from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class FeatureCheckService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whether the client's plan includes a feature. False when the client does not
   * exist (or is soft-deleted), has no plan, or the plan lacks the key.
   *
   * No caller yet: feature gating is not enforced (contract, assumption A20).
   *
   * @example
   * await featureCheck.clientHasFeature(clientId, PlanFeatureKey.AUTOMATED_PIX)
   */
  async clientHasFeature(
    clientId: string,
    key: PlanFeatureKey,
  ): Promise<boolean> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, ...NOT_DELETED },
      select: { plan: { select: { features: true } } },
    });
    return client?.plan?.features.includes(key) ?? false;
  }
}
