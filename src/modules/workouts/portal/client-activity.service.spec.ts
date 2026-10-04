import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { CLIENT_DIRECTORY } from "../../../common/ports";
import { PrismaService } from "../../prisma/prisma.service";
import { clientSummary } from "../testing/fixtures";
import { ClientActivityService } from "./client-activity.service";

describe("ClientActivityService", () => {
  let service: ClientActivityService;
  const prisma = { studentSession: { findMany: jest.fn() } };
  const clients = { requireOwned: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-10-03T15:30:00Z"));
    clients.requireOwned.mockResolvedValue(clientSummary());
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientActivityService,
        { provide: PrismaService, useValue: prisma },
        { provide: CLIENT_DIRECTORY, useValue: clients },
      ],
    }).compile();
    service = module.get(ClientActivityService);
  });
  afterEach(() => jest.useRealTimers());

  it("reads the client's sessions of the window and builds the heatmap", async () => {
    prisma.studentSession.findMany.mockResolvedValue([
      {
        completedAt: new Date("2026-10-02T09:00:00Z"),
        workoutName: "Treino A - Peito",
        durationSeconds: 3000,
      },
    ]);

    const result = await service.getHeatmap("user-1", "client-1", 3);

    expect(clients.requireOwned).toHaveBeenCalledWith("user-1", "client-1");
    expect(prisma.studentSession.findMany).toHaveBeenCalledWith({
      where: {
        clientId: "client-1",
        completedAt: { gte: new Date("2026-09-30T00:00:00Z") },
      },
      orderBy: { completedAt: "asc" },
      select: { completedAt: true, workoutName: true, durationSeconds: true },
    });
    expect(result).toMatchObject({
      studentId: "client-1",
      totalCompletedMonth: 1,
      currentStreak: 1,
      lastWorkoutDate: "2026-10-02T10:00:00.000Z",
    });
    expect(result.days.map((d) => d.status)).toEqual([
      "NO_ACTIVITY",
      "COMPLETED",
      "NO_ACTIVITY",
    ]);
  });

  it("defaults to 30 days", async () => {
    prisma.studentSession.findMany.mockResolvedValue([]);

    const result = await service.getHeatmap("user-1", "client-1");

    expect(result.days).toHaveLength(30);
  });

  it("answers 404 for a missing or soft-deleted client without reading sessions", async () => {
    clients.requireOwned.mockRejectedValue(new NotFoundException());

    await expect(service.getHeatmap("user-1", "gone")).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.studentSession.findMany).not.toHaveBeenCalled();
  });
});
