import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AssessmentType } from "@prisma/client";

import { EvaluationsService } from "./evaluations.service";
import { EvaluationsCalculatorService } from "./evaluations-calculator.service";
import { PrismaService } from "../prisma/prisma.service";
import { CLIENT_DIRECTORY } from "../../common/ports";

describe("EvaluationsService", () => {
  let service: EvaluationsService;
  let calculator: EvaluationsCalculatorService;
  let prisma: any;
  let clients: { requireOwned: jest.Mock };

  const userId = "trainer-uuid-1";
  const evaluationId = "eval-uuid-1";
  const clientId = "client-uuid-1";

  const mockClient = {
    id: clientId,
    userId,
    name: "Maria",
    dateOfBirth: null as Date | null,
  };
  const mockRow = {
    id: evaluationId,
    type: AssessmentType.PHYSICAL_EVALUATION,
    clientId,
    userId,
    date: new Date("2025-02-01"),
    data: { version: 1, weight: 65, height: 170, bodyFatPercentage: 22 },
    magicToken: null,
    tokenExpiresAt: null,
    createdAt: new Date("2025-02-01"),
    updatedAt: new Date("2025-02-01"),
  };

  beforeEach(async () => {
    prisma = {
      assessment: {
        create: jest.fn().mockResolvedValue(mockRow),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateManyAndReturn: jest.fn().mockResolvedValue([mockRow]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    clients = { requireOwned: jest.fn().mockResolvedValue(mockClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationsService,
        EvaluationsCalculatorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CLIENT_DIRECTORY, useValue: clients },
      ],
    }).compile();

    service = module.get(EvaluationsService);
    calculator = module.get(EvaluationsCalculatorService);
  });

  afterEach(() => jest.restoreAllMocks());

  const createdData = () => prisma.assessment.create.mock.calls[0][0].data;
  const updatedData = () =>
    prisma.assessment.updateManyAndReturn.mock.calls[0][0].data;
  /** Review L1: the owner and the live-client filter are part of the write itself. */
  const ownedWhere = {
    id: evaluationId,
    userId,
    type: AssessmentType.PHYSICAL_EVALUATION,
    client: { deletedAt: null },
  };

  describe("create", () => {
    it("should create a PHYSICAL_EVALUATION assessment for an owned client and return the flat view", async () => {
      const dto = {
        clientId,
        date: "2025-02-01",
        weight: 65,
        height: 170,
        bodyFatPercentage: 22,
      };
      const result = await service.create(userId, dto);

      expect(clients.requireOwned).toHaveBeenCalledWith(userId, clientId);
      expect(createdData()).toEqual({
        type: AssessmentType.PHYSICAL_EVALUATION,
        userId,
        clientId,
        date: new Date("2025-02-01"),
        data: {
          version: 1,
          weight: 65,
          height: 170,
          bodyFatPercentage: 22,
          protocol: "POLLOCK_3",
          equation: "SIRI",
        },
      });
      expect(result).toMatchObject({
        id: evaluationId,
        clientId,
        weight: 65,
        height: 170,
        bodyFatPercentage: 22,
      });
      expect(result).not.toHaveProperty("data");
      expect(result).not.toHaveProperty("version");
    });

    it("should throw NotFoundException when client does not exist (or is soft-deleted)", async () => {
      clients.requireOwned.mockRejectedValue(new NotFoundException());

      await expect(
        service.create(userId, {
          clientId: "non-existent",
          date: "2025-02-01",
          weight: 65,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.assessment.create).not.toHaveBeenCalled();
    });

    it("should throw ForbiddenException when client belongs to another user", async () => {
      clients.requireOwned.mockRejectedValue(new ForbiddenException());

      await expect(
        service.create(userId, { clientId, date: "2025-02-01", weight: 65 }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.assessment.create).not.toHaveBeenCalled();
    });

    it("should handle perimeters and skinfolds JSON and auto-calculate body composition", async () => {
      const dto = {
        clientId,
        date: "2025-02-01",
        weight: 65,
        perimeters: { waist: 75, hip: 95 },
        skinfolds: { triceps: 12, subscapular: 14 },
      };
      await service.create(userId, dto);

      const data = createdData().data;
      expect(data.perimeters).toEqual({ waist: 75, hip: 95 });
      expect(data.skinfolds).toEqual({ triceps: 12, subscapular: 14 });
      expect(typeof data.bodyFatPercentage).toBe("number");
      expect(typeof data.leanMass).toBe("number");
      expect(typeof data.fatMass).toBe("number");
      expect(typeof data.bodyDensity).toBe("number");
    });

    it("should handle empty perimeters/skinfolds (omit from data)", async () => {
      const calculate = jest.spyOn(calculator, "calculate");
      const dto = {
        clientId,
        date: "2025-02-01",
        weight: 65,
        perimeters: {},
        skinfolds: {},
      };
      await service.create(userId, dto);

      expect(createdData().data.perimeters).toBeUndefined();
      expect(createdData().data.skinfolds).toBeUndefined();
      expect(calculate).not.toHaveBeenCalled();
    });

    it("should call the calculator with gender M, age 30 by default and the default protocol/equation", async () => {
      const calculate = jest.spyOn(calculator, "calculate");
      await service.create(userId, {
        clientId,
        date: "2025-02-01",
        weight: 65,
        height: 170,
        skinfolds: { triceps: 12 },
      });

      expect(calculate).toHaveBeenCalledWith({
        gender: "M",
        age: 30,
        weight: 65,
        height: 170,
        skinfolds: { triceps: 12 },
        perimeters: undefined,
        protocol: "POLLOCK_3",
        equation: "SIRI",
      });
    });

    it("should derive the age from the client's birth year", async () => {
      const calculate = jest.spyOn(calculator, "calculate");
      const birthYear = new Date().getFullYear() - 41;
      clients.requireOwned.mockResolvedValue({
        ...mockClient,
        dateOfBirth: new Date(`${birthYear}-06-15`),
      });

      await service.create(userId, {
        clientId,
        date: "2025-02-01",
        weight: 65,
        skinfolds: { triceps: 12 },
      });

      expect(calculate.mock.calls[0][0].age).toBe(41);
    });

    it("should keep metrics sent by the trainer and store the protocol/equation the calculator used", async () => {
      jest.spyOn(calculator, "calculate").mockReturnValue({
        bodyDensity: 1.05,
        bodyFatPercentage: 20,
        fatMass: 13,
        leanMass: 52,
        protocolUsed: "PETROSKI_4",
        equationUsed: "BROZEK",
      });

      await service.create(userId, {
        clientId,
        date: "2025-02-01",
        weight: 65,
        bodyFatPercentage: 18,
        skinfolds: { calf: 10 },
      });

      expect(createdData().data).toMatchObject({
        bodyFatPercentage: 18,
        leanMass: 52,
        fatMass: 13,
        bodyDensity: 1.05,
        protocol: "PETROSKI_4",
        equation: "BROZEK",
      });
    });
  });

  describe("findAll", () => {
    it("should return the trainer's evaluations of live clients, newest date first", async () => {
      prisma.assessment.findMany.mockResolvedValue([
        { ...mockRow, client: { name: "Maria", avatar: null } },
      ]);

      const result = await service.findAll(userId);

      expect(prisma.assessment.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          type: AssessmentType.PHYSICAL_EVALUATION,
          client: { deletedAt: null },
        },
        include: { client: { select: { name: true, avatar: true } } },
        orderBy: { date: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: evaluationId,
        weight: 65,
        client: { name: "Maria", avatar: null },
      });
    });
  });

  describe("findOne", () => {
    it("should return evaluation when owned", async () => {
      prisma.assessment.findFirst.mockResolvedValue({
        ...mockRow,
        client: { name: "Maria", avatar: null },
      });

      const result = await service.findOne(userId, evaluationId);

      expect(prisma.assessment.findFirst).toHaveBeenCalledWith({
        where: {
          id: evaluationId,
          type: AssessmentType.PHYSICAL_EVALUATION,
          client: { deletedAt: null },
        },
        include: { client: { select: { name: true, avatar: true } } },
      });
      expect(result.id).toBe(evaluationId);
      expect(result.client).toEqual({ name: "Maria", avatar: null });
    });

    it("should throw NotFoundException when evaluation does not exist", async () => {
      prisma.assessment.findFirst.mockResolvedValue(null);
      await expect(service.findOne(userId, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when the evaluation belongs to another trainer", async () => {
      prisma.assessment.findFirst.mockResolvedValue({
        ...mockRow,
        userId: "other-user",
      });
      await expect(service.findOne(userId, evaluationId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("update", () => {
    it("should merge the patch over the stored data", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);

      await service.update(userId, evaluationId, {
        weight: 64,
        perimeters: { waist: 73 },
      });

      expect(prisma.assessment.updateManyAndReturn).toHaveBeenCalledWith({
        where: ownedWhere,
        data: {
          data: {
            version: 1,
            weight: 64,
            height: 170,
            bodyFatPercentage: 22,
            perimeters: { waist: 73 },
          },
        },
      });
    });

    it("should update the date column when the body carries a date", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);

      await service.update(userId, evaluationId, { date: "2025-03-01" });

      expect(updatedData().date).toEqual(new Date("2025-03-01"));
    });

    it("should recalculate with stored skinfolds, overriding stored metrics unless the body sends them", async () => {
      prisma.assessment.findFirst.mockResolvedValue({
        ...mockRow,
        data: {
          version: 1,
          weight: 65,
          bodyFatPercentage: 22,
          leanMass: 50,
          skinfolds: { triceps: 12 },
          protocol: "POLLOCK_7",
        },
      });
      const calculate = jest.spyOn(calculator, "calculate").mockReturnValue({
        bodyDensity: 1.06,
        bodyFatPercentage: 17,
        fatMass: 10.9,
        leanMass: 53.1,
        protocolUsed: "POLLOCK_7",
        equationUsed: "SIRI",
      });

      await service.update(userId, evaluationId, {
        weight: 64,
        leanMass: 54,
      });

      expect(calculate).toHaveBeenCalledWith({
        gender: "M",
        age: 30,
        weight: 64,
        height: undefined,
        skinfolds: { triceps: 12 },
        perimeters: undefined,
        protocol: "POLLOCK_7",
        equation: "SIRI",
      });
      expect(updatedData().data).toEqual({
        version: 1,
        weight: 64,
        bodyFatPercentage: 17,
        leanMass: 54,
        fatMass: 10.9,
        bodyDensity: 1.06,
        skinfolds: { triceps: 12 },
        protocol: "POLLOCK_7",
      });
    });

    it("should check the client through the directory (404 once the client is soft-deleted)", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);
      clients.requireOwned.mockRejectedValue(new NotFoundException());

      await expect(
        service.update(userId, evaluationId, { weight: 64 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.assessment.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("should reject a patch that makes the document invalid", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);

      await expect(
        service.update(userId, evaluationId, { weight: "heavy" } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.assessment.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("answers 404 when the row is gone by the time of the write (review L1)", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);
      prisma.assessment.updateManyAndReturn.mockResolvedValue([]);

      await expect(
        service.update(userId, evaluationId, { weight: 64 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("never writes through the unscoped update/delete (review L1)", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);

      await service.update(userId, evaluationId, { weight: 64 });
      await service.remove(userId, evaluationId);

      expect(prisma.assessment.update).not.toHaveBeenCalled();
      expect(prisma.assessment.delete).not.toHaveBeenCalled();
    });

    it("should refuse to update another trainer's evaluation", async () => {
      prisma.assessment.findFirst.mockResolvedValue({
        ...mockRow,
        userId: "other-user",
      });

      await expect(
        service.update(userId, evaluationId, { weight: 64 }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.assessment.updateManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("should delete evaluation after ownership check", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);

      await service.remove(userId, evaluationId);
      expect(prisma.assessment.deleteMany).toHaveBeenCalledWith({
        where: ownedWhere,
      });
    });

    it("answers 404 when nothing was deleted (review L1)", async () => {
      prisma.assessment.findFirst.mockResolvedValue(mockRow);
      prisma.assessment.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(userId, evaluationId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should not delete another trainer's evaluation", async () => {
      prisma.assessment.findFirst.mockResolvedValue({
        ...mockRow,
        userId: "other-user",
      });

      await expect(service.remove(userId, evaluationId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.assessment.deleteMany).not.toHaveBeenCalled();
    });
  });
});
