import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { PlanFeatureKey } from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";
import { PlansService } from "./plans.service";

describe("PlansService", () => {
  let service: PlansService;
  let prisma: any;

  const userId = "trainer-uuid-1";
  const planId = "plan-uuid-1";
  const include = {
    _count: { select: { clients: { where: { deletedAt: null } } } },
  };

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: planId,
    type: "PRESENCIAL",
    name: "Plano Básico",
    sessionsPerWeek: 3,
    durationMinutes: 60,
    price: 200,
    active: true,
    features: [],
    userId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    _count: { clients: 0 },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      plan: {
        create: jest.fn().mockResolvedValue(row()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(row()),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(row()),
        delete: jest.fn().mockResolvedValue(row()),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [PlansService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(PlansService);
  });

  describe("create", () => {
    const dto = {
      type: "PRESENCIAL" as const,
      name: "Plano Básico",
      sessionsPerWeek: 3,
      price: 200,
    };

    it("creates a plan tied to the trainer, with no features by default", async () => {
      const result = await service.create(userId, dto);

      expect(prisma.plan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Plano Básico",
          userId,
          features: [],
        }),
        include,
      });
      expect(result.id).toBe(planId);
      expect(result._count).toEqual({ clients: 0 });
    });

    it("stores the feature keys on the plan", async () => {
      const features = [
        PlanFeatureKey.AUTOMATED_PIX,
        PlanFeatureKey.ADVANCED_METRICS,
      ];
      prisma.plan.create.mockResolvedValue(row({ features }));

      const result = await service.create(userId, { ...dto, features });

      expect(prisma.plan.create.mock.calls[0][0].data.features).toEqual(
        features,
      );
      expect(result.features).toEqual(features);
    });
  });

  describe("findAll", () => {
    it("returns the trainer's plans with the count of live clients", async () => {
      prisma.plan.findMany.mockResolvedValue([row({ _count: { clients: 5 } })]);

      const result = await service.findAll(userId);

      expect(prisma.plan.findMany).toHaveBeenCalledWith({
        where: { userId },
        include,
      });
      expect(result).toHaveLength(1);
      expect(result[0]._count.clients).toBe(5);
    });

    it("drops stored keys that are no longer in the catalogue", async () => {
      prisma.plan.findMany.mockResolvedValue([
        row({ features: ["automated_pix", "retired_feature"] }),
      ]);

      const [plan] = await service.findAll(userId);

      expect(plan.features).toEqual(["automated_pix"]);
    });
  });

  describe("findOne", () => {
    it("returns the plan when found and owned", async () => {
      const result = await service.findOne(userId, planId);

      expect(prisma.plan.findUnique).toHaveBeenCalledWith({
        where: { id: planId },
        include,
      });
      expect(result.id).toBe(planId);
      expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("answers 404 when the plan does not exist", async () => {
      prisma.plan.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId, "missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("answers 403 when the plan belongs to another trainer", async () => {
      prisma.plan.findUnique.mockResolvedValue(row({ userId: "other-user" }));

      await expect(service.findOne(userId, planId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("update", () => {
    it("updates after the ownership check, writing only what was sent", async () => {
      prisma.plan.update.mockResolvedValue(row({ price: 250 }));

      const result = await service.update(userId, planId, { price: 250 });

      const args = prisma.plan.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: planId, userId });
      expect(args.include).toEqual(include);
      expect(JSON.parse(JSON.stringify(args.data))).toEqual({ price: 250 });
      expect(result.price).toBe(250);
    });

    it("replaces the features when given, including with an empty list", async () => {
      await service.update(userId, planId, {
        features: [PlanFeatureKey.AI_WHATSAPP_BOT],
      });
      expect(prisma.plan.update.mock.calls[0][0].data.features).toEqual([
        "ai_whatsapp_bot",
      ]);

      await service.update(userId, planId, { features: [] });
      expect(prisma.plan.update.mock.calls[1][0].data.features).toEqual([]);
    });

    it("does not write to another trainer's plan", async () => {
      prisma.plan.findUnique.mockResolvedValue(row({ userId: "other-user" }));

      await expect(
        service.update(userId, planId, { price: 1 }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.plan.update).not.toHaveBeenCalled();
    });

    it("answers 404 when the plan disappears between the check and the write (review L1)", async () => {
      prisma.plan.update.mockRejectedValue({ code: "P2025" });

      await expect(
        service.update(userId, planId, { price: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("ignores null for columns that cannot be null", async () => {
      await service.update(userId, planId, { name: null, price: null } as any);

      expect(
        JSON.parse(JSON.stringify(prisma.plan.update.mock.calls[0][0].data)),
      ).toEqual({});
    });
  });

  describe("remove", () => {
    it("deletes after the ownership check and returns the plan", async () => {
      const result = await service.remove(userId, planId);

      expect(prisma.plan.delete).toHaveBeenCalledWith({
        where: { id: planId, userId },
      });
      expect(result.id).toBe(planId);
    });

    it("answers 404 when the plan disappears between the check and the delete (review L1)", async () => {
      prisma.plan.delete.mockRejectedValue({ code: "P2025" });

      await expect(service.remove(userId, planId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rethrows any other delete error untouched", async () => {
      prisma.plan.delete.mockRejectedValue(new Error("DB down"));

      await expect(service.remove(userId, planId)).rejects.toThrow("DB down");
    });

    it("does not delete another trainer's plan", async () => {
      prisma.plan.findUnique.mockResolvedValue(row({ userId: "other-user" }));

      await expect(service.remove(userId, planId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.plan.delete).not.toHaveBeenCalled();
    });
  });

  describe("requireAssignable", () => {
    it("passes for one of the trainer's plans", async () => {
      prisma.plan.findFirst.mockResolvedValue({ id: planId });

      await expect(
        service.requireAssignable(userId, planId),
      ).resolves.toBeUndefined();
      expect(prisma.plan.findFirst).toHaveBeenCalledWith({
        where: { id: planId, userId },
        select: { id: true },
      });
    });

    it("answers 400 for a missing plan or another trainer's plan", async () => {
      prisma.plan.findFirst.mockResolvedValue(null);

      await expect(service.requireAssignable(userId, planId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("findPublicByTrainer", () => {
    it("groups active plans by type and describes their features", async () => {
      prisma.plan.findMany.mockResolvedValue([
        {
          id: "1",
          type: "PRESENCIAL",
          name: "P1",
          sessionsPerWeek: 3,
          durationMinutes: 60,
          price: 200,
          features: ["ai_whatsapp_bot", "retired_feature"],
        },
        {
          id: "2",
          type: "CONSULTORIA",
          name: "C1",
          sessionsPerWeek: 1,
          durationMinutes: null,
          price: 150,
          features: [],
        },
      ]);

      const result = await service.findPublicByTrainer(userId);

      expect(prisma.plan.findMany.mock.calls[0][0].where).toEqual({
        userId,
        active: true,
      });
      expect(result.presencial).toEqual([
        {
          id: "1",
          name: "P1",
          sessionsPerWeek: 3,
          sessionsPerMonth: 12,
          durationMinutes: 60,
          price: 200,
          features: [
            { key: "ai_whatsapp_bot", name: "Assistente WhatsApp com IA" },
          ],
        },
      ]);
      expect(result.consultoria).toEqual([
        { id: "2", name: "C1", sessionsPerWeek: 1, price: 150, features: [] },
      ]);
    });

    it("returns empty arrays when there are no active plans", async () => {
      await expect(service.findPublicByTrainer(userId)).resolves.toEqual({
        presencial: [],
        consultoria: [],
      });
    });
  });
});
