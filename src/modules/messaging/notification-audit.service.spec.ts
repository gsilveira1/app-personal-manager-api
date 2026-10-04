import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AuditEntry,
  NotificationAuditService,
} from "./notification-audit.service";

describe("NotificationAuditService", () => {
  const prisma = {
    notificationLog: { create: jest.fn(), findUnique: jest.fn() },
  };
  const service = new NotificationAuditService(
    prisma as unknown as PrismaService,
  );
  const entry: AuditEntry = {
    jobId: "job-1",
    userId: "user-1",
    clientId: "client-1",
    recipientPhone: "+5511999998888",
    templateType: "WORKOUT_LINK",
    status: "SENT",
    channel: "WHATSAPP",
    error: null,
  };

  beforeEach(() => jest.clearAllMocks());

  it("inserts one row with the job id", async () => {
    prisma.notificationLog.create.mockResolvedValue({ id: "log-1", ...entry });

    const row = await service.record(entry);

    expect(prisma.notificationLog.create).toHaveBeenCalledWith({ data: entry });
    expect(row).toEqual({ id: "log-1", ...entry });
  });

  it("tolerates P2002 on jobId: the outcome was already recorded", async () => {
    prisma.notificationLog.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
      }),
    );

    await expect(service.record(entry)).resolves.toBeNull();
  });

  it("rethrows every other database error", async () => {
    const fkError = new Prisma.PrismaClientKnownRequestError("FK failed", {
      code: "P2003",
      clientVersion: "7.0.0",
    });
    prisma.notificationLog.create.mockRejectedValueOnce(fkError);
    await expect(service.record(entry)).rejects.toBe(fkError);

    const down = new Error("connection refused");
    prisma.notificationLog.create.mockRejectedValueOnce(down);
    await expect(service.record(entry)).rejects.toBe(down);
  });

  it("finds the row of a job", async () => {
    prisma.notificationLog.findUnique.mockResolvedValue({ id: "log-1" });

    await expect(service.findByJobId("job-1")).resolves.toEqual({
      id: "log-1",
    });
    expect(prisma.notificationLog.findUnique).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
    });
  });
});
