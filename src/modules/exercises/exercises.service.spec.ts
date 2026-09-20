import { Test, TestingModule } from "@nestjs/testing";
import { ExercisesService } from "./exercises.service";
import { PrismaService } from "../prisma/prisma.service";

describe("ExercisesService", () => {
  let service: ExercisesService;
  let prisma: PrismaService;

  const mockPrismaService = {
    exercise: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExercisesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ExercisesService>(ExercisesService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it("should return global exercises and custom exercises", async () => {
    mockPrismaService.exercise.findMany.mockResolvedValue([
      {
        id: "custom-1",
        name: "Custom Supino",
        bodyPart: "chest",
        equipment: "barbell",
        isCustom: true,
      },
    ]);

    const results = await service.findAll("user-1", {
      bodyPart: "chest",
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((ex) => ex.name.includes("Bench Press"))).toBe(true);
    expect(results.some((ex) => ex.name === "Custom Supino")).toBe(true);
  });

  it("should create custom exercise for tenant", async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
    });
    mockPrismaService.exercise.create.mockResolvedValue({
      id: "new-ex-1",
      name: "Prancha Abdominal Custom",
      bodyPart: "waist",
      equipment: "bodyweight",
      isCustom: true,
      userId: "user-1",
      tenantId: "tenant-1",
    });

    const result = await service.create("user-1", {
      name: "Prancha Abdominal Custom",
      bodyPart: "waist",
      equipment: "bodyweight",
    });

    expect(result.id).toBe("new-ex-1");
    expect(mockPrismaService.exercise.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isCustom: true,
          userId: "user-1",
          tenantId: "tenant-1",
        }),
      }),
    );
  });
});
