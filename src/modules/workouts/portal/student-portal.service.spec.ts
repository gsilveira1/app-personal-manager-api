import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { CLIENT_DIRECTORY, USER_DIRECTORY } from "../../../common/ports";
import { buildExecutionData } from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";
import { clientSummary, sheetRow, trainerProfile } from "../testing/fixtures";
import { StudentPortalService } from "./student-portal.service";

describe("StudentPortalService", () => {
  let service: StudentPortalService;

  const prisma = {
    workoutSheet: { findFirst: jest.fn() },
    studentSession: { findFirst: jest.fn(), create: jest.fn() },
  };
  const jwt = { verify: jest.fn() };
  const clients = { findById: jest.fn() };
  const users = { getProfile: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    jwt.verify.mockReturnValue({ clientId: "client-1", action: "WORKOUT" });
    clients.findById.mockResolvedValue(clientSummary());
    users.getProfile.mockResolvedValue(trainerProfile());
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentPortalService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: CLIENT_DIRECTORY, useValue: clients },
        { provide: USER_DIRECTORY, useValue: users },
      ],
    }).compile();
    service = module.get(StudentPortalService);
  });

  describe("token check (in the contract's order)", () => {
    it("401 when the token is invalid or expired", async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error("jwt expired");
      });

      await expect(service.getActiveSheet("bad")).rejects.toThrow(
        new UnauthorizedException("Token inválido ou expirado."),
      );
      expect(clients.findById).not.toHaveBeenCalled();
    });

    it("verifies the token against the portal audience only (regression M1)", async () => {
      await service.getActiveSheet("token");

      expect(jwt.verify).toHaveBeenCalledWith("token", {
        audience: "vivi:portal",
      });
    });

    it("403 when the token was not issued for workouts (e.g. a trainer access token)", async () => {
      jwt.verify.mockReturnValue({ sub: "user-1", role: "trainer" });

      await expect(service.getActiveSheet("token")).rejects.toThrow(
        new ForbiddenException("Token não autorizado para execução de treino."),
      );
      expect(clients.findById).not.toHaveBeenCalled();
    });

    it("401 when a workout token carries no client id", async () => {
      jwt.verify.mockReturnValue({ action: "WORKOUT" });

      await expect(service.getActiveSheet("token")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("404 when the client does not exist or was soft-deleted", async () => {
      clients.findById.mockResolvedValue(null);

      await expect(service.getActiveSheet("token")).rejects.toThrow(
        new NotFoundException("Aluno não encontrado."),
      );
      expect(users.getProfile).not.toHaveBeenCalled();
    });

    it.each(["BLOCKED", "OVERDUE"])(
      "403 when the trainer account is %s",
      async (status) => {
        users.getProfile.mockResolvedValue(trainerProfile({ status }));

        await expect(service.getActiveSheet("token")).rejects.toThrow(
          new ForbiddenException(
            "Plataforma temporariamente indisponível. Por favor, contate seu treinador.",
          ),
        );
        expect(users.getProfile).toHaveBeenCalledWith("user-1");
      },
    );

    it("403 when the student is PAUSED", async () => {
      clients.findById.mockResolvedValue(clientSummary({ status: "PAUSED" }));

      await expect(service.getActiveSheet("token")).rejects.toThrow(
        new ForbiddenException(
          "Seus treinos estão pausados no momento. Fale com seu treinador para retornar.",
        ),
      );
    });

    it("the account block wins over the paused student", async () => {
      users.getProfile.mockResolvedValue(trainerProfile({ status: "BLOCKED" }));
      clients.findById.mockResolvedValue(clientSummary({ status: "PAUSED" }));

      await expect(service.getActiveSheet("token")).rejects.toThrow(
        /Plataforma temporariamente indisponível/,
      );
    });

    it("the same guards protect recording a session", async () => {
      clients.findById.mockResolvedValue(clientSummary({ status: "PAUSED" }));

      await expect(
        service.recordSession("token", {
          workoutId: "w-1",
          durationSeconds: 1,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.studentSession.create).not.toHaveBeenCalled();
    });
  });

  describe("getActiveSheet", () => {
    it("returns the placeholder when the student has no active sheet", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(null);

      await expect(service.getActiveSheet("token")).resolves.toEqual({
        sheetId: null,
        sheetName: "Nenhuma ficha ativa",
        workouts: [],
      });
      expect(prisma.studentSession.findFirst).not.toHaveBeenCalled();
    });

    it("returns the sheet with ids from the structure and the last loads pre-populated", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow());
      prisma.studentSession.findFirst.mockResolvedValue({
        id: "session-1",
        executionData: buildExecutionData({
          sheetId: "sheet-1",
          itemId: "w-1",
          loads: [{ workoutExerciseId: "we-1", loadKg: 62.5 }],
        }),
      });

      const result = await service.getActiveSheet("token");

      expect(prisma.workoutSheet.findFirst).toHaveBeenCalledWith({
        where: { clientId: "client-1", active: true, isTemplate: false },
        orderBy: { createdAt: "desc" },
      });
      expect(prisma.studentSession.findFirst).toHaveBeenCalledWith({
        where: { clientId: "client-1" },
        orderBy: { completedAt: "desc" },
      });
      expect(result).toMatchObject({
        sheetId: "sheet-1",
        sheetName: "Ficha A",
        trainerName: "Viviana Trainer",
        trainerPhone: "+5511977776666",
      });
      expect(result.workouts[0]).toMatchObject({
        id: "w-1",
        letter: "A",
        name: "Peito",
      });
      const [block] = result.workouts[0].blocks;
      expect(block).toMatchObject({
        id: "b-1",
        type: "REGULAR",
        restTimeSeconds: 60,
      });
      expect(block.exercises[0]).toEqual({
        workoutExerciseId: "we-1",
        exerciseName: "Supino",
        gifUrl: "https://pub-r2.com/exercises/bench.gif",
        sets: 4,
        reps: "10",
        executionNotes: null,
        lastLoadKg: 62.5,
      });
    });

    it("falls back to suggestedLoadKg, then null, when there is no previous load", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow());
      prisma.studentSession.findFirst.mockResolvedValue(null);

      const result = await service.getActiveSheet("token");

      const { exercises } = result.workouts[0].blocks[0];
      expect(exercises[0].lastLoadKg).toBe(50);
      expect(exercises[1].lastLoadKg).toBeNull();
    });

    it("fails loudly when the last session has a malformed executionData", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow());
      prisma.studentSession.findFirst.mockResolvedValue({
        id: "session-1",
        executionData: [{ workoutExerciseId: "we-1", loadKg: 60 }],
      });

      await expect(service.getActiveSheet("token")).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("uses the display fallbacks when the trainer has no phone", async () => {
      users.getProfile.mockResolvedValue(trainerProfile({ phone: null }));
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow());
      prisma.studentSession.findFirst.mockResolvedValue(null);

      const result = await service.getActiveSheet("token");

      expect(result.trainerPhone).toBe("");
    });
  });

  describe("recordSession", () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-03T12:00:00Z"));
      prisma.studentSession.create.mockResolvedValue({
        id: "session-1",
        durationSeconds: 3000,
      });
    });
    afterEach(() => jest.useRealTimers());

    it("stores executionData built with buildExecutionData, pointing at the active sheet", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow());
      const loads = [
        { workoutExerciseId: "we-1", loadKg: 65 },
        { workoutExerciseId: "we-2", completed: false },
      ];

      const result = await service.recordSession("token", {
        workoutId: "w-1",
        durationSeconds: 3000,
        completedAt: "2026-10-02T18:00:00.000Z",
        loads,
      });

      expect(result).toEqual({
        message: "Treino finalizado com sucesso!",
        sessionId: "session-1",
        durationSeconds: 3000,
      });
      expect(prisma.studentSession.create).toHaveBeenCalledWith({
        data: {
          clientId: "client-1",
          workoutName: "Treino A - Peito",
          durationSeconds: 3000,
          completedAt: new Date("2026-10-02T18:00:00.000Z"),
          executionData: buildExecutionData({
            sheetId: "sheet-1",
            itemId: "w-1",
            loads,
          }),
        },
      });
      const { executionData } =
        prisma.studentSession.create.mock.calls[0][0].data;
      expect(executionData).toEqual({
        version: 1,
        sheetId: "sheet-1",
        itemId: "w-1",
        exercises: [
          { workoutExerciseId: "we-1", loadKg: 65, completed: true },
          { workoutExerciseId: "we-2", loadKg: null, completed: false },
        ],
      });
    });

    it("records a generic session when the workout is not an item of the active sheet", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow());

      await service.recordSession("token", {
        workoutId: "stale-item",
        durationSeconds: 600,
      });

      expect(prisma.studentSession.create).toHaveBeenCalledWith({
        data: {
          clientId: "client-1",
          workoutName: "Treino Realizado",
          durationSeconds: 600,
          completedAt: new Date("2026-10-03T12:00:00Z"),
          executionData: {
            version: 1,
            sheetId: null,
            itemId: "stale-item",
            exercises: [],
          },
        },
      });
    });

    it("records a generic session when the student has no active sheet", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(null);

      await service.recordSession("token", {
        workoutId: "w-1",
        durationSeconds: 600,
      });

      const { data } = prisma.studentSession.create.mock.calls[0][0];
      expect(data.workoutName).toBe("Treino Realizado");
      expect(data.executionData).toMatchObject({
        sheetId: null,
        itemId: "w-1",
      });
    });
  });
});
