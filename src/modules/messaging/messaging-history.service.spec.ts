import { ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MessagingHistoryService } from "./messaging-history.service";
import { PendingNotificationsService } from "./pending-notifications.service";

describe("MessagingHistoryService", () => {
  const prisma = {
    notificationLog: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const pending = { list: jest.fn() };
  const service = new MessagingHistoryService(
    prisma as unknown as PrismaService,
    pending as unknown as PendingNotificationsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.notificationLog.count.mockResolvedValue(0);
    prisma.notificationLog.findMany.mockResolvedValue([]);
    prisma.notificationLog.groupBy.mockResolvedValue([]);
    pending.list.mockResolvedValue([]);
  });

  describe("getLogs", () => {
    it("returns a page of the caller's rows with the summary", async () => {
      const items = [{ id: "log-1" }, { id: "log-2" }];
      prisma.notificationLog.count.mockResolvedValue(45);
      prisma.notificationLog.findMany.mockResolvedValue(items);
      prisma.notificationLog.groupBy.mockResolvedValue([
        { status: "SENT", _count: { _all: 30 } },
        { status: "FAILED", _count: { _all: 12 } },
        { status: "CANCELLED", _count: { _all: 3 } },
      ]);
      pending.list.mockResolvedValue([{ jobId: "a" }, { jobId: "b" }]);

      const result = await service.getLogs("user-1", { page: 2, limit: 20 });

      expect(prisma.notificationLog.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        skip: 20,
        take: 20,
        orderBy: { createdAt: "desc" },
      });
      expect(prisma.notificationLog.groupBy).toHaveBeenCalledWith({
        by: ["status"],
        where: { userId: "user-1" },
        _count: { _all: true },
      });
      expect(pending.list).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({
        items,
        total: 45,
        page: 2,
        totalPages: 3,
        summary: {
          totalSent: 30,
          totalFailed: 12,
          totalCancelled: 3,
          totalPending: 2,
        },
      });
    });

    it("returns an empty first page with zeroed summary", async () => {
      await expect(service.getLogs("user-1", {})).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        totalPages: 1,
        summary: {
          totalSent: 0,
          totalFailed: 0,
          totalCancelled: 0,
          totalPending: 0,
        },
      });
    });

    it("applies status, channel and search filters to the page but not to the summary", async () => {
      await service.getLogs("user-1", {
        status: "FAILED",
        channel: "WHATSAPP",
        search: "5511",
      });

      const where = {
        userId: "user-1",
        status: "FAILED",
        channel: "WHATSAPP",
        OR: [
          { recipientPhone: { contains: "5511", mode: "insensitive" } },
          { templateType: { contains: "5511", mode: "insensitive" } },
          { error: { contains: "5511", mode: "insensitive" } },
        ],
      };
      expect(prisma.notificationLog.count).toHaveBeenCalledWith({ where });
      expect(prisma.notificationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(prisma.notificationLog.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1" } }),
      );
    });

    it("ALL means no filter", async () => {
      await service.getLogs("user-1", { status: "ALL", channel: "ALL" });

      expect(prisma.notificationLog.count).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
    });

    it("does not report totalPending = 0 when the queue is unreachable", async () => {
      pending.list.mockRejectedValue(new ServiceUnavailableException());

      await expect(service.getLogs("user-1", {})).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe("getClientMessages", () => {
    it("matches rows by caller and client id, newest first", async () => {
      const rows = [{ id: "log-2" }, { id: "log-1" }];
      prisma.notificationLog.findMany.mockResolvedValue(rows);

      const result = await service.getClientMessages("user-1", "client-1");

      expect(prisma.notificationLog.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1", clientId: "client-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(rows);
    });

    it("yields [] for an unknown or foreign client", async () => {
      await expect(
        service.getClientMessages("user-1", "someone-elses-client"),
      ).resolves.toEqual([]);
    });
  });
});
