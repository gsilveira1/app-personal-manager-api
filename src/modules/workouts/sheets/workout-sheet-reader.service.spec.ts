import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { sheetRow } from "../testing/fixtures";
import { WorkoutSheetReaderService } from "./workout-sheet-reader.service";

describe("WorkoutSheetReaderService (WORKOUT_SHEET_READER)", () => {
  let reader: WorkoutSheetReaderService;
  const prisma = {
    workoutSheet: { findMany: jest.fn(), findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutSheetReaderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    reader = module.get(WorkoutSheetReaderService);
  });

  describe("findActiveSummaries", () => {
    it("returns the active sheet of each client in one query; clients without one are absent", async () => {
      const expiresAt = new Date("2026-11-01T00:00:00Z");
      prisma.workoutSheet.findMany.mockResolvedValue([
        { id: "sheet-1", name: "Ficha A", expiresAt, clientId: "client-1" },
      ]);

      const result = await reader.findActiveSummaries("user-1", [
        "client-1",
        "client-2",
      ]);

      expect(prisma.workoutSheet.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.workoutSheet.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          clientId: { in: ["client-1", "client-2"] },
          active: true,
          isTemplate: false,
        },
        select: { id: true, name: true, expiresAt: true, clientId: true },
      });
      expect(result.get("client-1")).toEqual({
        id: "sheet-1",
        name: "Ficha A",
        expiresAt,
      });
      expect(result.has("client-2")).toBe(false);
    });

    it("does not query for an empty id list", async () => {
      const result = await reader.findActiveSummaries("user-1", []);

      expect(result.size).toBe(0);
      expect(prisma.workoutSheet.findMany).not.toHaveBeenCalled();
    });
  });

  describe("resolveSegments", () => {
    it("resolves many pointers with one query and leaves out the ones that no longer resolve", async () => {
      prisma.workoutSheet.findMany.mockResolvedValue([sheetRow()]);

      const result = await reader.resolveSegments("user-1", [
        { sheetId: "sheet-1", segmentId: "w-1" },
        { sheetId: "sheet-1", segmentId: "removed-item" },
        { sheetId: "other-trainer-sheet", segmentId: "w-1" },
      ]);

      expect(prisma.workoutSheet.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          id: { in: ["sheet-1", "other-trainer-sheet"] },
        },
        select: { id: true, structure: true },
      });
      expect(result).toEqual([
        { sheetId: "sheet-1", segmentId: "w-1", name: "Peito", letter: "A" },
      ]);
    });

    it("does not query for an empty list", async () => {
      await expect(reader.resolveSegments("user-1", [])).resolves.toEqual([]);
      expect(prisma.workoutSheet.findMany).not.toHaveBeenCalled();
    });

    it("fails loudly on a malformed stored structure", async () => {
      prisma.workoutSheet.findMany.mockResolvedValue([
        sheetRow({ structure: null }),
      ]);

      await expect(
        reader.resolveSegments("user-1", [
          { sheetId: "sheet-1", segmentId: "w-1" },
        ]),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("assertSegment", () => {
    it("passes for an owned sheet without a segment", async () => {
      prisma.workoutSheet.findUnique.mockResolvedValue(sheetRow());

      await expect(
        reader.assertSegment("user-1", { sheetId: "sheet-1", segmentId: null }),
      ).resolves.toBeUndefined();
    });

    it("passes for an item of that sheet", async () => {
      prisma.workoutSheet.findUnique.mockResolvedValue(sheetRow());

      await expect(
        reader.assertSegment("user-1", {
          sheetId: "sheet-1",
          segmentId: "w-1",
        }),
      ).resolves.toBeUndefined();
    });

    it("answers 404 when the sheet does not exist", async () => {
      prisma.workoutSheet.findUnique.mockResolvedValue(null);

      await expect(
        reader.assertSegment("user-1", { sheetId: "nope" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("answers 404 (not 403) when the sheet belongs to another trainer", async () => {
      prisma.workoutSheet.findUnique.mockResolvedValue(
        sheetRow({ userId: "user-2" }),
      );

      await expect(
        reader.assertSegment("user-1", { sheetId: "sheet-1" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("answers 400 when the segment is not an item of the sheet", async () => {
      prisma.workoutSheet.findUnique.mockResolvedValue(sheetRow());

      await expect(
        reader.assertSegment("user-1", { sheetId: "sheet-1", segmentId: "x" }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
