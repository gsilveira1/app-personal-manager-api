import { getQueueToken } from "@nestjs/bullmq";
import {
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NOTIFICATIONS_QUEUE } from "../../common/types";
import { NotificationAuditService } from "./notification-audit.service";
import { PendingJobIndex } from "./pending-job-index.service";
import { PendingNotificationsService } from "./pending-notifications.service";

const T0 = Date.parse("2026-09-20T05:30:00.000Z");

function fakeJob(
  id: string,
  userId: string,
  overrides: Record<string, any> = {},
) {
  return {
    id,
    data: {
      version: 1,
      idempotencyKey: id,
      userId,
      clientId: `client-of-${id}`,
      recipientPhone: "+5511999998888",
      channel: "WHATSAPP",
      templateType: "WORKOUT_LINK",
      params: { name: "Ana" },
      requestedAt: new Date(T0).toISOString(),
    },
    timestamp: T0,
    delay: 0,
    attemptsMade: 0,
    promote: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue("delayed"),
    ...overrides,
  };
}

describe("PendingNotificationsService", () => {
  let service: PendingNotificationsService;
  const queue = { getJob: jest.fn() };
  const index = { entries: jest.fn(), remove: jest.fn(), add: jest.fn() };
  const audit = { record: jest.fn(), findByJobId: jest.fn() };
  /** The queue's content; the index of a user holds the ids of that user's jobs. */
  let jobsByState: Record<string, any[]>;
  const queued = () =>
    Object.entries(jobsByState).flatMap(([state, jobs]) =>
      jobs.map((job) => ({ state, job })),
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jobsByState = { waiting: [], delayed: [], active: [] };
    index.entries.mockImplementation(async (userId: string) =>
      queued()
        .filter(({ job }) => job.data.userId === userId)
        .map(({ job }) => ({ jobId: job.id, addedAt: T0 })),
    );
    index.remove.mockResolvedValue(undefined);
    queue.getJob.mockImplementation(async (id: string) => {
      const found = queued().find(({ job }) => job.id === id);
      return found && { ...found.job, getState: async () => found.state };
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PendingNotificationsService,
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: queue },
        { provide: NotificationAuditService, useValue: audit },
        { provide: PendingJobIndex, useValue: index },
      ],
    }).compile();
    service = moduleRef.get(PendingNotificationsService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("list", () => {
    it("returns only the caller's waiting, delayed and active jobs", async () => {
      jobsByState.waiting = [fakeJob("w1", "user-1"), fakeJob("w2", "user-2")];
      jobsByState.delayed = [fakeJob("d1", "user-1", { delay: 9_000_000 })];
      jobsByState.active = [fakeJob("a1", "user-1", { attemptsMade: 2 })];

      const result = await service.list("user-1");

      expect(index.entries).toHaveBeenCalledWith("user-1");
      expect(result.map((j) => [j.jobId, j.state])).toEqual([
        ["w1", "waiting"],
        ["d1", "delayed"],
        ["a1", "active"],
      ]);
      expect(result[1]).toEqual({
        jobId: "d1",
        templateType: "WORKOUT_LINK",
        recipientPhone: "+5511999998888",
        clientId: "client-of-d1",
        state: "delayed",
        scheduledFor: new Date(T0 + 9_000_000).toISOString(),
        attemptsMade: 0,
        requestedAt: new Date(T0).toISOString(),
      });
      expect(result[0].scheduledFor).toBeNull();
      expect(result[2].attemptsMade).toBe(2);
    });

    it("sorts by request time, newest first", async () => {
      const older = fakeJob("old", "user-1");
      const newer = fakeJob("new", "user-1");
      newer.data.requestedAt = new Date(T0 + 60_000).toISOString();
      jobsByState.waiting = [older];
      jobsByState.delayed = [newer];

      const result = await service.list("user-1");

      expect(result.map((j) => j.jobId)).toEqual(["new", "old"]);
    });

    it("does not guess the due time of a job waiting on retry backoff", async () => {
      jobsByState.delayed = [
        fakeJob("d1", "user-1", { attemptsMade: 1, delay: 30_000 }),
      ];

      const [view] = await service.list("user-1");

      expect(view.scheduledFor).toBeNull();
    });

    it("answers 503 when Redis is unreachable", async () => {
      index.entries.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.list("user-1")).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe("flush", () => {
    it("promotes only the caller's delayed jobs", async () => {
      const mine = [fakeJob("d1", "user-1"), fakeJob("d2", "user-1")];
      const theirs = fakeJob("d3", "user-2");
      const waiting = fakeJob("w1", "user-1");
      jobsByState.delayed = [...mine, theirs];
      jobsByState.waiting = [waiting];

      const result = await service.flush("user-1");

      expect(result.promotedCount).toBe(2);
      expect(result.message).toContain("2");
      mine.forEach((job) => expect(job.promote).toHaveBeenCalledTimes(1));
      expect(theirs.promote).not.toHaveBeenCalled();
      expect(waiting.promote).not.toHaveBeenCalled();
    });

    it("returns 0 when nothing is delayed", async () => {
      await expect(service.flush("user-1")).resolves.toEqual({
        promotedCount: 0,
        message: "Nenhuma mensagem aguardando envio.",
      });
    });

    it("counts and logs a job that could not be promoted", async () => {
      const ok = fakeJob("d1", "user-1");
      const raced = fakeJob("d2", "user-1", {
        promote: jest
          .fn()
          .mockRejectedValue(new Error("Job d2 is not in the delayed state")),
      });
      jobsByState.delayed = [ok, raced];

      const result = await service.flush("user-1");

      expect(result.promotedCount).toBe(1);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining("not in the delayed state"),
      );
    });

    it("answers 503 when no job could be promoted", async () => {
      jobsByState.delayed = [
        fakeJob("d1", "user-1", {
          promote: jest.fn().mockRejectedValue(new Error("ECONNRESET")),
        }),
      ];

      await expect(service.flush("user-1")).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe("cancel", () => {
    const row = { id: "log-1", jobId: "d1", status: "CANCELLED" };

    it("removes the job and writes a CANCELLED audit row", async () => {
      const job = fakeJob("d1", "user-1");
      queue.getJob.mockResolvedValue(job);
      audit.record.mockResolvedValue(row);

      const result = await service.cancel("user-1", "d1");

      expect(job.remove).toHaveBeenCalledTimes(1);
      expect(index.remove).toHaveBeenCalledWith("user-1", "d1");
      expect(audit.record).toHaveBeenCalledWith({
        jobId: "d1",
        userId: "user-1",
        clientId: "client-of-d1",
        recipientPhone: "+5511999998888",
        templateType: "WORKOUT_LINK",
        channel: "WHATSAPP",
        status: "CANCELLED",
        error: "Cancelado manualmente pelo treinador.",
      });
      expect(result).toEqual({
        message: "Mensagem cancelada com sucesso.",
        notification: row,
      });
    });

    it("still cancels, and logs, when the index entry cannot be removed (the next read drops it)", async () => {
      queue.getJob.mockResolvedValue(fakeJob("d1", "user-1"));
      audit.record.mockResolvedValue(row);
      index.remove.mockRejectedValue(new Error("ECONNRESET"));

      const result = await service.cancel("user-1", "d1");

      expect(result.notification).toBe(row);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining("ECONNRESET"),
        expect.any(String),
      );
    });

    it("404 for an unknown job", async () => {
      queue.getJob.mockResolvedValue(undefined);

      await expect(service.cancel("user-1", "nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("404 for another trainer's job, which is left untouched", async () => {
      const job = fakeJob("d1", "user-2");
      queue.getJob.mockResolvedValue(job);

      await expect(service.cancel("user-1", "d1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(job.remove).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("409 for a job that is being sent", async () => {
      const job = fakeJob("a1", "user-1", {
        getState: jest.fn().mockResolvedValue("active"),
      });
      queue.getJob.mockResolvedValue(job);

      await expect(service.cancel("user-1", "a1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(job.remove).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("409 when a worker picks the job up between the check and the removal", async () => {
      const job = fakeJob("w1", "user-1", {
        getState: jest
          .fn()
          .mockResolvedValueOnce("waiting")
          .mockResolvedValueOnce("active"),
        remove: jest
          .fn()
          .mockRejectedValue(new Error("locked by another worker")),
      });
      queue.getJob.mockResolvedValue(job);

      await expect(service.cancel("user-1", "w1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each(["completed", "failed"])(
      "404 for a %s job: it is no longer pending and its row must stay",
      async (state) => {
        const job = fakeJob("c1", "user-1", {
          getState: jest.fn().mockResolvedValue(state),
        });
        queue.getJob.mockResolvedValue(job);

        await expect(service.cancel("user-1", "c1")).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(job.remove).not.toHaveBeenCalled();
      },
    );

    it("returns the existing row when the outcome was already recorded", async () => {
      queue.getJob.mockResolvedValue(fakeJob("d1", "user-1"));
      audit.record.mockResolvedValue(null);
      audit.findByJobId.mockResolvedValue(row);

      const result = await service.cancel("user-1", "d1");

      expect(audit.findByJobId).toHaveBeenCalledWith("d1");
      expect(result.notification).toBe(row);
    });

    it("answers 503 when Redis is unreachable", async () => {
      queue.getJob.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.cancel("user-1", "d1")).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
