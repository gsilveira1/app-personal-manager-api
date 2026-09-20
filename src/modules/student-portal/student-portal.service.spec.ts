import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { StudentPortalService } from "./student-portal.service";
import { PrismaService } from "../prisma/prisma.service";
import { ForbiddenException } from "@nestjs/common";

describe("StudentPortalService", () => {
  let service: StudentPortalService;
  let prisma: PrismaService;
  let jwt: JwtService;

  const mockPrismaService = {
    client: {
      findUnique: jest.fn(),
    },
    workoutSheet: {
      findFirst: jest.fn(),
    },
    studentSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    workoutSheetItem: {
      findUnique: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue("student-jwt-123"),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentPortalService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<StudentPortalService>(StudentPortalService);
    prisma = module.get<PrismaService>(PrismaService);
    jwt = module.get<JwtService>(JwtService);
    jest.clearAllMocks();
  });

  it("should block access if student status is PAUSED", async () => {
    mockJwtService.verify.mockReturnValue({
      clientId: "client-1",
      action: "WORKOUT",
    });
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      subscriptionStatus: "PAUSED",
      user: { tenant: { status: "ACTIVE" } },
    });

    await expect(
      service.getStudentActiveWorkoutSheet("valid-token"),
    ).rejects.toThrow("Seus treinos estão pausados no momento. Fale com seu treinador para retornar.");
  });

  it("should block access if tenant status is BLOCKED", async () => {
    mockJwtService.verify.mockReturnValue({
      clientId: "client-1",
      action: "WORKOUT",
    });
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      subscriptionStatus: "ACTIVE",
      user: { tenant: { status: "BLOCKED" } },
    });

    await expect(
      service.getStudentActiveWorkoutSheet("valid-token"),
    ).rejects.toThrow("Plataforma temporariamente indisponível. Por favor, contate seu treinador.");
  });

  it("should return workout sheet with pre-populated last loads", async () => {
    mockJwtService.verify.mockReturnValue({
      clientId: "client-1",
      action: "WORKOUT",
    });
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      name: "Mariana",
      phone: "+5511999998888",
      subscriptionStatus: "ACTIVE",
      user: {
        name: "Viviana Trainer",
        phone: "+5511977776666",
        tenant: { status: "ACTIVE" },
      },
    });
    mockPrismaService.workoutSheet.findFirst.mockResolvedValue({
      id: "sheet-1",
      name: "Ficha A",
      workouts: [
        {
          id: "w-1",
          letter: "A",
          name: "Peito",
          blocks: [
            {
              id: "b-1",
              type: "REGULAR",
              restTimeSeconds: 60,
              exercises: [
                {
                  id: "we-1",
                  exerciseName: "Supino",
                  sets: 4,
                  reps: "10",
                  suggestedLoadKg: 50,
                },
              ],
            },
          ],
        },
      ],
    });
    mockPrismaService.studentSession.findFirst.mockResolvedValue({
      loads: [{ workoutExerciseId: "we-1", loadKg: 62.5 }],
    });

    const result = await service.getStudentActiveWorkoutSheet("valid-token");
    expect(result.sheetName).toBe("Ficha A");
    expect(result.trainerName).toBe("Viviana Trainer");
    expect(result.trainerPhone).toBe("+5511977776666");
    expect(result.workouts[0].blocks[0].exercises[0].lastLoadKg).toBe(62.5);
  });

  it("should record student workout session", async () => {
    mockJwtService.verify.mockReturnValue({
      clientId: "client-1",
      action: "WORKOUT",
    });
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      subscriptionStatus: "ACTIVE",
      user: { tenant: { status: "ACTIVE" } },
    });
    mockPrismaService.workoutSheetItem.findUnique.mockResolvedValue({
      letter: "A",
      name: "Peito e Tríceps",
    });
    mockPrismaService.studentSession.create.mockResolvedValue({
      id: "session-1",
      durationSeconds: 3000,
    });

    const result = await service.recordStudentSession("valid-token", {
      workoutId: "w-1",
      durationSeconds: 3000,
      loads: [{ workoutExerciseId: "we-1", loadKg: 65 }],
    });

    expect(result.sessionId).toBe("session-1");
    expect(mockPrismaService.studentSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: "client-1",
          durationSeconds: 3000,
          workoutName: "Treino A - Peito e Tríceps",
        }),
      }),
    );
  });
});
