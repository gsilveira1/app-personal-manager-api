import { PlanFeatureKey } from "../../../common/types";
import { FeatureCheckService } from "./feature-check.service";

describe("FeatureCheckService", () => {
  let service: FeatureCheckService;
  let prisma: { client: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { client: { findFirst: jest.fn() } };
    service = new FeatureCheckService(prisma as any);
  });

  it("returns false when the client has no plan", async () => {
    prisma.client.findFirst.mockResolvedValue({ plan: null });

    await expect(
      service.clientHasFeature("client-1", PlanFeatureKey.AI_WHATSAPP_BOT),
    ).resolves.toBe(false);
  });

  it("returns false when the client does not exist or is soft-deleted", async () => {
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(
      service.clientHasFeature("gone", PlanFeatureKey.AI_WHATSAPP_BOT),
    ).resolves.toBe(false);
    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: "gone", deletedAt: null },
      select: { plan: { select: { features: true } } },
    });
  });

  it("returns true when the plan has the feature", async () => {
    prisma.client.findFirst.mockResolvedValue({
      plan: { features: ["ai_whatsapp_bot", "automated_pix"] },
    });

    await expect(
      service.clientHasFeature("client-1", PlanFeatureKey.AI_WHATSAPP_BOT),
    ).resolves.toBe(true);
  });

  it("returns false when the plan does not have the feature", async () => {
    prisma.client.findFirst.mockResolvedValue({
      plan: { features: ["automated_pix"] },
    });

    await expect(
      service.clientHasFeature("client-1", PlanFeatureKey.ADVANCED_METRICS),
    ).resolves.toBe(false);
  });

  it("reads client and plan in one query", async () => {
    prisma.client.findFirst.mockResolvedValue({ plan: { features: [] } });

    await service.clientHasFeature("client-1", PlanFeatureKey.AUTOMATED_PIX);

    expect(prisma.client.findFirst).toHaveBeenCalledTimes(1);
  });
});
