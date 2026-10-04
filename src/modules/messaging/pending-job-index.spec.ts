import { getQueueToken } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EnqueueNotificationRequest, USER_DIRECTORY } from "../../common/ports";
import { DEFAULT_DND, NOTIFICATIONS_QUEUE } from "../../common/types";
import { NotificationAuditService } from "./notification-audit.service";
import { NotificationSenderService } from "./notification-sender.service";
import { INDEX_GRACE_MS, PendingJobIndex } from "./pending-job-index.service";
import { PendingNotificationsService } from "./pending-notifications.service";
import { FakeNotificationsQueue } from "./testing/fake-notifications-queue";

const TRAINER_A = "trainer-a";
const TRAINER_B = "trainer-b";
// 02:30 BRT: inside the default do-not-disturb window, so every job is delayed
const NIGHT = new Date("2026-09-20T05:30:00.000Z");

const requestOf = (
  userId: string,
  idempotencyKey: string,
): EnqueueNotificationRequest => ({
  userId,
  clientId: `client-of-${userId}`,
  recipientPhone: "+5511999998888",
  templateType: "WORKOUT_LINK",
  params: { name: "Ana" },
  idempotencyKey,
});

describe("pending notifications read through the per-trainer index (regression M3)", () => {
  let queue: FakeNotificationsQueue;
  let sender: NotificationSenderService;
  let pending: PendingNotificationsService;
  let index: PendingJobIndex;
  let errorLog: jest.SpyInstance;
  const audit = { record: jest.fn(), findByJobId: jest.fn() };
  const users = {
    getSettings: jest.fn().mockResolvedValue({ dnd: DEFAULT_DND }),
  };
  const indexedIds = async (userId: string) =>
    (await index.entries(userId)).map((entry) => entry.jobId);

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NIGHT);
    errorLog = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    queue = new FakeNotificationsQueue();

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationSenderService,
        PendingNotificationsService,
        PendingJobIndex,
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: queue },
        { provide: USER_DIRECTORY, useValue: users },
        { provide: NotificationAuditService, useValue: audit },
      ],
    }).compile();
    sender = moduleRef.get(NotificationSenderService);
    pending = moduleRef.get(PendingNotificationsService);
    index = moduleRef.get(PendingJobIndex);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("with trainer B holding 1,001 delayed jobs newer than trainer A's only one", () => {
    beforeEach(async () => {
      await sender.enqueue(requestOf(TRAINER_A, "a-1"));
      for (let i = 0; i < 1001; i++) {
        await sender.enqueue(requestOf(TRAINER_B, `b-${i}`));
      }
    });

    it("list(A) returns A's job", async () => {
      const result = await pending.list(TRAINER_A);

      expect(result.map((view) => view.jobId)).toEqual(["a-1"]);
      expect(result[0].state).toBe("delayed");
    });

    it("list(B) returns all 1,001 of B's jobs", async () => {
      await expect(pending.list(TRAINER_B)).resolves.toHaveLength(1001);
    });

    it("flush(A) promotes A's job and none of B's", async () => {
      const result = await pending.flush(TRAINER_A);

      expect(result.promotedCount).toBe(1);
      await expect(queue.getJobs(["delayed"])).resolves.toHaveLength(1001);
    });

    it("never scans the jobs of all tenants", async () => {
      await pending.list(TRAINER_A);
      await pending.flush(TRAINER_A);

      expect(queue.getJobs).not.toHaveBeenCalled();
    });
  });

  describe("enqueue", () => {
    it("indexes the id before adding the job", async () => {
      await sender.enqueue(requestOf(TRAINER_A, "a-1"));

      expect(await indexedIds(TRAINER_A)).toEqual(["a-1"]);
      expect(queue.redis.hset.mock.invocationCallOrder[0]).toBeLessThan(
        queue.add.mock.invocationCallOrder[0],
      );
    });

    it("stays idempotent: a repeated key is indexed once and queued once", async () => {
      await sender.enqueue(requestOf(TRAINER_A, "a-1"));
      const second = await sender.enqueue(requestOf(TRAINER_A, "a-1"));

      expect(second.status).toBe("DUPLICATE");
      expect(await indexedIds(TRAINER_A)).toEqual(["a-1"]);
      await expect(pending.list(TRAINER_A)).resolves.toHaveLength(1);
    });

    it("answers 503, logs and queues nothing when the index cannot be written", async () => {
      queue.redis.hset.mockRejectedValueOnce(new Error("ECONNRESET"));

      await expect(
        sender.enqueue(requestOf(TRAINER_A, "a-1")),
      ).rejects.toMatchObject({ status: 503 });
      expect(queue.add).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("ECONNRESET"),
        expect.any(String),
      );
    });

    it("leaves an entry that readers drop when the job could not be added after it was indexed", async () => {
      queue.add.mockRejectedValueOnce(new Error("ECONNRESET"));
      await expect(
        sender.enqueue(requestOf(TRAINER_A, "a-1")),
      ).rejects.toMatchObject({ status: 503 });
      expect(await indexedIds(TRAINER_A)).toEqual(["a-1"]);

      jest.setSystemTime(NIGHT.getTime() + INDEX_GRACE_MS + 1);

      await expect(pending.list(TRAINER_A)).resolves.toEqual([]);
      expect(await indexedIds(TRAINER_A)).toEqual([]);
    });
  });

  describe("entries that no longer point at a pending job", () => {
    it("keeps a fresh entry without a job: the job may be about to be added", async () => {
      await index.add(TRAINER_A, "a-1");

      await expect(pending.list(TRAINER_A)).resolves.toEqual([]);
      expect(await indexedIds(TRAINER_A)).toEqual(["a-1"]);
    });

    it.each(["completed", "failed"])(
      "drops the entry of a %s job and does not list it",
      async (state) => {
        await sender.enqueue(requestOf(TRAINER_A, "a-1"));
        await sender.enqueue(requestOf(TRAINER_A, "a-2"));
        queue.setState("a-1", state);

        const result = await pending.list(TRAINER_A);

        expect(result.map((view) => view.jobId)).toEqual(["a-2"]);
        expect(await indexedIds(TRAINER_A)).toEqual(["a-2"]);
      },
    );

    it("drops and logs an entry that points at another trainer's job, without listing it", async () => {
      await sender.enqueue(requestOf(TRAINER_B, "b-1"));
      await index.add(TRAINER_A, "b-1");

      await expect(pending.list(TRAINER_A)).resolves.toEqual([]);
      expect(await indexedIds(TRAINER_A)).toEqual([]);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("b-1"));
      await expect(pending.list(TRAINER_B)).resolves.toHaveLength(1);
    });

    it("removes the entry when the trainer cancels the job", async () => {
      await sender.enqueue(requestOf(TRAINER_A, "a-1"));
      audit.record.mockResolvedValue({ id: "log-1" });

      await pending.cancel(TRAINER_A, "a-1");

      expect(await indexedIds(TRAINER_A)).toEqual([]);
    });
  });
});
