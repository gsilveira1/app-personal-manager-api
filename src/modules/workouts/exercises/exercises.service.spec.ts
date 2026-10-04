import { Test, TestingModule } from "@nestjs/testing";
import { ExercisesService } from "./exercises.service";
import { PrismaService } from "../../prisma/prisma.service";

describe("ExercisesService", () => {
  let service: ExercisesService;

  const prisma = {
    exercise: { findMany: jest.fn(), create: jest.fn() },
  };

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "ex-1",
    name: "Custom Supino",
    bodyPart: "chest",
    targetMuscle: null,
    equipment: "barbell",
    gifUrl: null,
    videoUrl: null,
    userId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExercisesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ExercisesService);
  });

  describe("findAll", () => {
    it("returns global and custom exercises, flagged with isCustom and without userId", async () => {
      prisma.exercise.findMany.mockResolvedValue([
        row({ id: "g-1", name: "Barbell Bench Press", userId: null }),
        row(),
      ]);

      const results = await service.findAll("user-1", { bodyPart: "chest" });

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ id: "g-1", isCustom: false });
      expect(results[1]).toMatchObject({ id: "ex-1", isCustom: true });
      expect(results[0]).not.toHaveProperty("userId");
    });

    it("scopes the catalogue to the caller's rows plus the global ones, ordered by name", async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll("user-1", {});

      expect(prisma.exercise.findMany).toHaveBeenCalledWith({
        where: { AND: [{ OR: [{ userId: "user-1" }, { userId: null }] }] },
        orderBy: { name: "asc" },
      });
    });

    it("regression: a search never widens the ownership scope (no top-level OR collision)", async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll("user-1", { search: "supino" });

      const { where } = prisma.exercise.findMany.mock.calls[0][0];
      expect(where).not.toHaveProperty("OR");
      expect(where.AND).toEqual([
        { OR: [{ userId: "user-1" }, { userId: null }] },
        {
          OR: [
            { name: { contains: "supino", mode: "insensitive" } },
            { targetMuscle: { contains: "supino", mode: "insensitive" } },
          ],
        },
      ]);
    });

    it("applies bodyPart and equipment as case-insensitive equality filters", async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll("user-1", {
        bodyPart: "Chest",
        equipment: "BARBELL",
      });

      const { where } = prisma.exercise.findMany.mock.calls[0][0];
      expect(where.AND).toEqual([
        { OR: [{ userId: "user-1" }, { userId: null }] },
        { bodyPart: { equals: "Chest", mode: "insensitive" } },
        { equipment: { equals: "BARBELL", mode: "insensitive" } },
      ]);
    });
  });

  describe("create", () => {
    it("always creates a private exercise owned by the caller", async () => {
      prisma.exercise.create.mockResolvedValue(
        row({ id: "new-ex-1", name: "Prancha Abdominal Custom" }),
      );

      const result = await service.create("user-1", {
        name: "Prancha Abdominal Custom",
        bodyPart: "waist",
        equipment: "bodyweight",
      });

      expect(result).toMatchObject({ id: "new-ex-1", isCustom: true });
      expect(prisma.exercise.create).toHaveBeenCalledWith({
        data: {
          name: "Prancha Abdominal Custom",
          bodyPart: "waist",
          equipment: "bodyweight",
          userId: "user-1",
        },
      });
    });
  });
});
