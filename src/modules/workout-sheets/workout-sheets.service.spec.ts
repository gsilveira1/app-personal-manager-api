import { Test, TestingModule } from "@nestjs/testing";
import { WorkoutSheetsService } from "./workout-sheets.service";
import { PrismaService } from "../prisma/prisma.service";
import { BadRequestException } from "@nestjs/common";

describe("WorkoutSheetsService", () => {
  let service: WorkoutSheetsService;
  let prisma: PrismaService;

  const mockPrismaService: any = {
    client: {
      findUnique: jest.fn(),
    },
    workoutSheet: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    workoutSheetItem: {
      create: jest.fn(),
    },
    workoutBlock: {
      create: jest.fn(),
    },
    workoutExercise: {
      create: jest.fn(),
    },
    workoutTemplate: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback: (prisma: any) => Promise<any>) =>
      callback(mockPrismaService),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutSheetsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<WorkoutSheetsService>(WorkoutSheetsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it("should throw BadRequestException if BISET has less than 2 exercises", async () => {
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      userId: "user-1",
    });

    const invalidDto = {
      name: "Ficha Inválida",
      workouts: [
        {
          letter: "A",
          name: "Peito",
          blocks: [
            {
              type: "BISET",
              exercises: [{ exerciseName: "Supino" }],
            },
          ],
        },
      ],
    };

    await expect(
      service.createForStudent("user-1", "client-1", invalidDto as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("should create workout sheet with blocks inside transaction", async () => {
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      userId: "user-1",
    });
    mockPrismaService.workoutSheet.create.mockResolvedValue({
      id: "sheet-1",
      name: "Ficha Hipertrofia",
    });
    mockPrismaService.workoutSheetItem.create.mockResolvedValue({
      id: "item-1",
      letter: "A",
      name: "Peito",
    });
    mockPrismaService.workoutBlock.create.mockResolvedValue({
      id: "block-1",
      type: "REGULAR",
    });
    mockPrismaService.workoutExercise.create.mockResolvedValue({
      id: "we-1",
    });
    mockPrismaService.workoutSheet.findUnique.mockResolvedValue({
      id: "sheet-1",
      name: "Ficha Hipertrofia",
      workouts: [],
    });

    const validDto = {
      name: "Ficha Hipertrofia",
      workouts: [
        {
          letter: "A",
          name: "Peito",
          blocks: [
            {
              type: "REGULAR",
              exercises: [{ exerciseName: "Supino Reto", sets: 4, reps: "8-10" }],
            },
          ],
        },
      ],
    };

    const result = await service.createForStudent(
      "user-1",
      "client-1",
      validDto as any,
    );

    expect(result?.id).toBe("sheet-1");
    expect(mockPrismaService.$transaction).toHaveBeenCalled();
  });

  it("should save sheet as template", async () => {
    mockPrismaService.workoutSheet.findUnique.mockResolvedValue({
      id: "sheet-1",
      userId: "user-1",
      name: "Ficha Base",
      workouts: [],
    });
    mockPrismaService.workoutTemplate.create.mockResolvedValue({
      id: "tmpl-1",
      name: "Template Hipertrofia",
    });

    const result = await service.saveAsTemplate("user-1", "sheet-1", {
      name: "Template Hipertrofia",
    });

    expect(result.id).toBe("tmpl-1");
    expect(mockPrismaService.workoutTemplate.create).toHaveBeenCalled();
  });
});
