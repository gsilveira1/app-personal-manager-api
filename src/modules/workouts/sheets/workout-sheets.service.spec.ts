import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { CLIENT_DIRECTORY } from "../../../common/ports";
import {
  OF_LIVE_CLIENT,
  WITHOUT_DELETED_CLIENT,
} from "../../../common/prisma/soft-delete";
import { PrismaService } from "../../prisma/prisma.service";
import {
  clientSummary,
  SHEET_INPUT,
  sheetRow,
  structureFixture,
} from "../testing/fixtures";
import { WorkoutSheetsService } from "./workout-sheets.service";

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

describe("WorkoutSheetsService", () => {
  let service: WorkoutSheetsService;

  const prisma: any = {
    workoutSheet: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
      callback(prisma),
    ),
  };
  const clients = { requireOwned: jest.fn(), findManyOwned: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: any) => Promise<unknown>) => callback(prisma),
    );
    clients.requireOwned.mockResolvedValue(clientSummary());
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutSheetsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CLIENT_DIRECTORY, useValue: clients },
      ],
    }).compile();
    service = module.get(WorkoutSheetsService);
  });

  describe("createForClient", () => {
    it("rejects a BISET with fewer than 2 exercises before touching the database", async () => {
      const dto = {
        name: "Ficha Inválida",
        workouts: [
          {
            letter: "A",
            name: "Peito",
            blocks: [
              {
                type: "BISET" as const,
                exercises: [{ exerciseName: "Supino" }],
              },
            ],
          },
        ],
      };

      await expect(
        service.createForClient("user-1", "client-1", dto),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("propagates the ownership failure of the client directory", async () => {
      clients.requireOwned.mockRejectedValue(new ForbiddenException());

      await expect(
        service.createForClient("user-1", "client-9", {
          name: "Ficha",
          ...SHEET_INPUT,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("deactivates the client's active sheets and inserts the new one as active, in one transaction", async () => {
      prisma.workoutSheet.create.mockImplementation(({ data }: any) =>
        Promise.resolve(sheetRow({ ...data, id: "sheet-new" })),
      );

      const result = await service.createForClient("user-1", "client-1", {
        name: "Ficha Hipertrofia",
        expiresAt: "2026-12-01T00:00:00.000Z",
        ...SHEET_INPUT,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.workoutSheet.updateMany).toHaveBeenCalledWith({
        where: { clientId: "client-1", active: true, isTemplate: false },
        data: { active: false },
      });
      expect(prisma.workoutSheet.create).toHaveBeenCalledWith({
        data: {
          name: "Ficha Hipertrofia",
          expiresAt: new Date("2026-12-01T00:00:00.000Z"),
          active: true,
          isTemplate: false,
          clientId: "client-1",
          userId: "user-1",
          structure: structureFixture(),
        },
      });
      expect(result).toMatchObject({
        id: "sheet-new",
        active: true,
        isTemplate: false,
        description: null,
        tags: [],
      });
      expect(result.workouts[0].blocks[0].exercises[0].id).toBe("we-1");
      expect(result).not.toHaveProperty("structure");
    });

    it("assigns ids to segments sent without one", async () => {
      prisma.workoutSheet.create.mockImplementation(({ data }: any) =>
        Promise.resolve(sheetRow(data)),
      );

      const result = await service.createForClient("user-1", "client-1", {
        name: "Ficha",
        workouts: [
          {
            letter: "A",
            name: "Peito",
            blocks: [{ type: "REGULAR", exercises: [{}] }],
          },
        ],
      });

      const [item] = result.workouts;
      expect(item.id).toEqual(expect.any(String));
      expect(item.blocks[0].exercises[0]).toMatchObject({
        id: expect.any(String),
        exerciseName: "Exercício",
        sets: 3,
        reps: "10-12",
      });
    });

    it("retries once when a concurrent create wins the one-active-sheet index (P2002)", async () => {
      prisma.workoutSheet.create
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce(sheetRow());

      const result = await service.createForClient("user-1", "client-1", {
        name: "Ficha A",
        ...SHEET_INPUT,
      });

      expect(result.id).toBe("sheet-1");
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("answers 409 when the retry also loses the race", async () => {
      prisma.workoutSheet.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.createForClient("user-1", "client-1", {
          name: "Ficha A",
          ...SHEET_INPUT,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("does not retry or mask any other database error", async () => {
      prisma.workoutSheet.create.mockRejectedValue(
        new Error("connection lost"),
      );

      await expect(
        service.createForClient("user-1", "client-1", {
          name: "Ficha A",
          ...SHEET_INPUT,
        }),
      ).rejects.toThrow("connection lost");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("findByClient", () => {
    it("lists the client's sheets newest first after the ownership check", async () => {
      prisma.workoutSheet.findMany.mockResolvedValue([sheetRow()]);

      const result = await service.findByClient("user-1", "client-1");

      expect(clients.requireOwned).toHaveBeenCalledWith("user-1", "client-1");
      expect(prisma.workoutSheet.findMany).toHaveBeenCalledWith({
        where: { clientId: "client-1", userId: "user-1", isTemplate: false },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("answers 404 for a missing or soft-deleted client", async () => {
      clients.requireOwned.mockRejectedValue(new NotFoundException());

      await expect(service.findByClient("user-1", "gone")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.workoutSheet.findMany).not.toHaveBeenCalled();
    });
  });

  describe("findOne", () => {
    it("returns the view with every level sorted by orderIndex", async () => {
      const structure = structureFixture({
        workouts: [
          { id: "w-b", letter: "B", name: "Costas", orderIndex: 1, blocks: [] },
          {
            id: "w-a",
            letter: "A",
            name: "Peito",
            orderIndex: 0,
            blocks: [
              {
                id: "b-1",
                type: "REGULAR",
                exercises: [
                  { id: "e-2", orderIndex: 1 },
                  { id: "e-1", orderIndex: 0 },
                ],
              },
            ],
          },
        ],
      });
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow({ structure }));

      const result = await service.findOne("user-1", "sheet-1");

      expect(result.workouts.map((w) => w.id)).toEqual(["w-a", "w-b"]);
      expect(result.workouts[0].blocks[0].exercises.map((e) => e.id)).toEqual([
        "e-1",
        "e-2",
      ]);
      expect(prisma.workoutSheet.findFirst).toHaveBeenCalledWith({
        where: { id: "sheet-1", ...WITHOUT_DELETED_CLIENT },
      });
    });

    it("answers 404 when the sheet does not exist (or its client was deleted)", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(null);

      await expect(service.findOne("user-1", "nope")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("answers 403 when the sheet belongs to another trainer", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(
        sheetRow({ userId: "user-2" }),
      );

      await expect(service.findOne("user-1", "sheet-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("fails loudly on a malformed stored structure instead of rendering an empty sheet", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(
        sheetRow({ structure: { workouts: [] } }),
      );

      await expect(service.findOne("user-1", "sheet-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("update", () => {
    beforeEach(() => {
      prisma.workoutSheet.findFirst.mockResolvedValue(sheetRow());
      prisma.workoutSheet.update.mockImplementation(({ data }: any) =>
        Promise.resolve(sheetRow(data)),
      );
    });

    it("keeps the ids the client sends back when workouts are replaced", async () => {
      const result = await service.update("user-1", "sheet-1", {
        workouts: [
          {
            id: "w-1",
            letter: "A",
            name: "Peito e Tríceps",
            blocks: [
              {
                id: "b-1",
                type: "REGULAR",
                exercises: [
                  { id: "we-1", exerciseName: "Supino", sets: 5 },
                  { exerciseName: "Tríceps Corda" },
                ],
              },
            ],
          },
        ],
      });

      const [item] = result.workouts;
      expect(item).toMatchObject({ id: "w-1", name: "Peito e Tríceps" });
      expect(item.blocks[0].id).toBe("b-1");
      expect(item.blocks[0].exercises[0]).toMatchObject({
        id: "we-1",
        sets: 5,
      });
      expect(item.blocks[0].exercises[1].id).toEqual(expect.any(String));
      expect(item.blocks[0].exercises.map((e) => e.id)).not.toContain("we-2");
      expect(prisma.workoutSheet.update).toHaveBeenCalledWith({
        where: { id: "sheet-1", userId: "user-1" },
        data: { structure: expect.objectContaining({ version: 1 }) },
      });
    });

    it("patches description and tags alone without touching the items", async () => {
      const result = await service.update("user-1", "sheet-1", {
        description: "Fase 2",
        tags: ["hipertrofia"],
      });

      expect(result.description).toBe("Fase 2");
      expect(result.tags).toEqual(["hipertrofia"]);
      expect(result.workouts).toEqual(structureFixture().items);
    });

    it("keeps the stored description and tags when only workouts are sent", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(
        sheetRow({
          structure: structureFixture({
            ...SHEET_INPUT,
            description: "Base",
            tags: ["a"],
          }),
        }),
      );

      const result = await service.update("user-1", "sheet-1", {
        workouts: [],
      });

      expect(result).toMatchObject({
        description: "Base",
        tags: ["a"],
        workouts: [],
      });
    });

    it("updates name and clears expiresAt with null, leaving the structure alone", async () => {
      await service.update("user-1", "sheet-1", {
        name: "Novo nome",
        expiresAt: null,
      });

      expect(prisma.workoutSheet.update).toHaveBeenCalledWith({
        where: { id: "sheet-1", userId: "user-1" },
        data: { name: "Novo nome", expiresAt: null },
      });
    });

    it("rejects duplicate ids in the new structure", async () => {
      await expect(
        service.update("user-1", "sheet-1", {
          workouts: [
            { id: "dup", letter: "A", name: "A", blocks: [] },
            { id: "dup", letter: "B", name: "B", blocks: [] },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workoutSheet.update).not.toHaveBeenCalled();
    });

    it("answers 403 for another trainer's sheet without writing", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(
        sheetRow({ userId: "user-2" }),
      );

      await expect(
        service.update("user-1", "sheet-1", { name: "x" }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.workoutSheet.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deletes an owned sheet or template", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(
        sheetRow({ isTemplate: true, clientId: null }),
      );

      const result = await service.remove("user-1", "sheet-1");

      expect(prisma.workoutSheet.delete).toHaveBeenCalledWith({
        where: { id: "sheet-1", userId: "user-1" },
      });
      expect(result.message).toContain("sucesso");
    });

    it("answers 404 for an unknown id without deleting", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(null);

      await expect(service.remove("user-1", "nope")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.workoutSheet.delete).not.toHaveBeenCalled();
    });
  });

  describe("templates", () => {
    it("lists the trainer's templates newest first", async () => {
      prisma.workoutSheet.findMany.mockResolvedValue([
        sheetRow({ isTemplate: true, clientId: null }),
      ]);

      const result = await service.findTemplates("user-1");

      expect(prisma.workoutSheet.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1", isTemplate: true },
        orderBy: { createdAt: "desc" },
      });
      expect(result[0].isTemplate).toBe(true);
    });

    it("creates a template: isTemplate, no client, active", async () => {
      prisma.workoutSheet.create.mockImplementation(({ data }: any) =>
        Promise.resolve(sheetRow(data)),
      );

      const result = await service.createTemplate("user-1", {
        name: "Novo Treino",
        description: "Desc",
        tags: ["peito"],
        ...SHEET_INPUT,
      });

      expect(prisma.workoutSheet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Novo Treino",
          isTemplate: true,
          clientId: null,
          active: true,
          expiresAt: null,
          userId: "user-1",
        }),
      });
      expect(result).toMatchObject({ description: "Desc", tags: ["peito"] });
      expect(prisma.workoutSheet.updateMany).not.toHaveBeenCalled();
    });

    it("saves a sheet as a template, copying the structure as is and setting the description", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(
        sheetRow({ name: "Ficha Base" }),
      );
      prisma.workoutSheet.create.mockImplementation(({ data }: any) =>
        Promise.resolve(sheetRow({ ...data, id: "tmpl-1" })),
      );

      const result = await service.saveAsTemplate("user-1", "sheet-1", {
        name: "Template Hipertrofia",
        description: "Base de hipertrofia",
      });

      expect(result).toMatchObject({
        id: "tmpl-1",
        name: "Template Hipertrofia",
        isTemplate: true,
        clientId: null,
        description: "Base de hipertrofia",
      });
      expect(result.workouts).toEqual(structureFixture().items);
    });

    it("refuses to copy another trainer's sheet", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(
        sheetRow({ userId: "user-2" }),
      );

      await expect(
        service.saveAsTemplate("user-1", "sheet-1", { name: "T" }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.workoutSheet.create).not.toHaveBeenCalled();
    });
  });

  describe("findExpiring", () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-03T12:00:00Z"));
    });
    afterEach(() => jest.useRealTimers());

    it("queries active, non-template sheets of live clients expiring within 5 days", async () => {
      prisma.workoutSheet.findMany.mockResolvedValue([]);
      clients.findManyOwned.mockResolvedValue(new Map());

      await service.findExpiring("user-1");

      expect(prisma.workoutSheet.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          active: true,
          isTemplate: false,
          expiresAt: {
            gte: new Date("2026-10-03T12:00:00Z"),
            lte: new Date("2026-10-08T12:00:00Z"),
          },
          ...OF_LIVE_CLIENT,
        },
        orderBy: { expiresAt: "asc" },
      });
    });

    it("pairs each sheet with its client, read through the client directory in one call", async () => {
      const expiresAt = new Date("2026-10-05T00:00:00Z");
      prisma.workoutSheet.findMany.mockResolvedValue([sheetRow({ expiresAt })]);
      clients.findManyOwned.mockResolvedValue(
        new Map([["client-1", clientSummary()]]),
      );

      const result = await service.findExpiring("user-1");

      expect(clients.findManyOwned).toHaveBeenCalledWith("user-1", [
        "client-1",
      ]);
      expect(result).toEqual([
        {
          client: {
            id: "client-1",
            name: "Mariana",
            avatar: null,
            phone: "+5511999998888",
          },
          sheet: { id: "sheet-1", name: "Ficha A", expiresAt },
        },
      ]);
    });

    it("leaves out (and logs) a sheet whose client vanished between the two reads", async () => {
      prisma.workoutSheet.findMany.mockResolvedValue([
        sheetRow({ expiresAt: new Date("2026-10-05T00:00:00Z") }),
      ]);
      clients.findManyOwned.mockResolvedValue(new Map());
      const warn = jest
        .spyOn(service["logger"], "warn")
        .mockImplementation(() => undefined);

      await expect(service.findExpiring("user-1")).resolves.toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("sheet-1"));
    });
  });
});
