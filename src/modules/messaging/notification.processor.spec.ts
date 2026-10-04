import { Logger } from "@nestjs/common";
import { UnrecoverableError } from "bullmq";
import { UserDirectory } from "../../common/ports";
import {
  InvalidRecipientError,
  NotificationJobData,
  WhatsAppInstanceError,
  WhatsAppNotConnectedError,
  WhatsAppTransientError,
} from "../../common/types";
import {
  AuditEntry,
  NotificationAuditService,
} from "./notification-audit.service";
import {
  NotificationJob,
  NotificationProcessor,
} from "./notification.processor";
import { PendingJobIndex } from "./pending-job-index.service";
import { WhatsAppService } from "./whatsapp.service";

const JOB_DATA: NotificationJobData = {
  version: 1,
  idempotencyKey: "a".repeat(40),
  userId: "user-1",
  clientId: "client-1",
  recipientPhone: "+5511999998888",
  channel: "WHATSAPP",
  templateType: "WORKOUT_LINK",
  params: { name: "Mariana", link: "https://app/#/p/vivi?token=abc" },
  requestedAt: "2026-09-20T05:30:00.000Z",
};

/** A BullMQ job as the worker sees it; `fail()` mimics BullMQ after a failed attempt. */
function buildJob(overrides: Partial<NotificationJobData> = {}) {
  const job = {
    id: JOB_DATA.idempotencyKey,
    data: { ...JOB_DATA, ...overrides },
    opts: { attempts: 5 },
    attemptsMade: 0,
    progress: 0 as unknown,
    updateProgress: jest.fn(async (value: unknown) => {
      job.progress = value;
    }),
  };
  return job;
}
type FakeJob = ReturnType<typeof buildJob>;
const asJob = (job: FakeJob) => job as unknown as NotificationJob;

describe("NotificationProcessor", () => {
  let processor: NotificationProcessor;
  let rows: AuditEntry[];
  const users = {
    getWhatsappConnection: jest.fn(),
    setWhatsappConnection: jest.fn(),
    getSettings: jest.fn(),
  };
  const whatsapp = { sendTextMessage: jest.fn() };
  const audit = { findByJobId: jest.fn(), record: jest.fn() };
  const index = { remove: jest.fn() };
  let errorLog: jest.SpyInstance;

  /** Runs attempts the way BullMQ would, until the job completes or fails for good. */
  async function runToCompletion(job: FakeJob) {
    for (;;) {
      try {
        return { result: await processor.process(asJob(job)), error: null };
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.opts.attempts;
        if (error instanceof UnrecoverableError || exhausted) {
          return { result: null, error: error as Error };
        }
        job.attemptsMade += 1;
      }
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    rows = [];
    errorLog = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    users.getWhatsappConnection.mockResolvedValue({
      instanceName: "user-abc12345",
      status: "CONNECTED",
    });
    users.setWhatsappConnection.mockResolvedValue({
      instanceName: "user-abc12345",
      status: "DISCONNECTED",
    });
    whatsapp.sendTextMessage.mockResolvedValue({ messageId: "msg-1" });
    audit.findByJobId.mockImplementation(
      async (jobId: string) => rows.find((r) => r.jobId === jobId) ?? null,
    );
    audit.record.mockImplementation(async (entry: AuditEntry) => {
      if (rows.some((r) => r.jobId === entry.jobId)) return null; // P2002
      rows.push(entry);
      return { id: `log-${rows.length}`, ...entry };
    });
    processor = new NotificationProcessor(
      users as unknown as UserDirectory,
      whatsapp as unknown as WhatsAppService,
      audit as unknown as NotificationAuditService,
      index as unknown as PendingJobIndex,
    );
  });

  describe("pending-job index (regression M3)", () => {
    const finished = (state: string) =>
      ({
        ...buildJob(),
        getState: jest.fn().mockResolvedValue(state),
      }) as unknown as NotificationJob;

    it("removes a completed job from its trainer's index", async () => {
      await processor.onCompleted(asJob(buildJob()));

      expect(index.remove).toHaveBeenCalledWith(
        JOB_DATA.userId,
        JOB_DATA.idempotencyKey,
      );
    });

    it("removes a job that failed for good", async () => {
      await processor.onFailed(finished("failed"));

      expect(index.remove).toHaveBeenCalledWith(
        JOB_DATA.userId,
        JOB_DATA.idempotencyKey,
      );
    });

    it("keeps a job whose failed attempt will be retried: it is still pending", async () => {
      await processor.onFailed(finished("delayed"));

      expect(index.remove).not.toHaveBeenCalled();
    });

    it("logs instead of rejecting when the index cannot be updated", async () => {
      index.remove.mockRejectedValue(new Error("ECONNRESET"));

      await expect(
        processor.onCompleted(asJob(buildJob())),
      ).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("ECONNRESET"),
        expect.any(String),
      );
    });
  });

  afterEach(() => jest.restoreAllMocks());

  describe("success", () => {
    it("sends the rendered template and writes one SENT row", async () => {
      const result = await processor.process(asJob(buildJob()));

      expect(result).toBe("SENT");
      expect(users.getWhatsappConnection).toHaveBeenCalledWith("user-1");
      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(
        "user-abc12345",
        "+5511999998888",
        "Fala, Mariana! Sua nova ficha de treinos está pronta. Acesse aqui: https://app/#/p/vivi?token=abc.",
      );
      expect(rows).toEqual([
        {
          jobId: JOB_DATA.idempotencyKey,
          userId: "user-1",
          clientId: "client-1",
          recipientPhone: "+5511999998888",
          templateType: "WORKOUT_LINK",
          channel: "WHATSAPP",
          status: "SENT",
          error: null,
        },
      ]);
    });

    it("records a null clientId for messages not addressed to a client", async () => {
      await processor.process(asJob(buildJob({ clientId: null })));
      expect(rows[0].clientId).toBeNull();
    });
  });

  describe("retryable failure", () => {
    const transient = () =>
      new WhatsAppTransientError("upstream unavailable", 503);

    it("rethrows the transient error without writing a row while attempts remain", async () => {
      const error = transient();
      whatsapp.sendTextMessage.mockRejectedValueOnce(error);

      await expect(processor.process(asJob(buildJob()))).rejects.toBe(error);

      expect(error).not.toBeInstanceOf(UnrecoverableError);
      expect(rows).toHaveLength(0);
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });

    it("fails once, then succeeds on the retry: one SENT row", async () => {
      whatsapp.sendTextMessage.mockRejectedValueOnce(transient());
      const job = buildJob();

      const { result } = await runToCompletion(job);

      expect(result).toBe("SENT");
      expect(job.attemptsMade).toBe(1);
      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "SENT", error: null });
    });

    it("sends the same text on every attempt", async () => {
      whatsapp.sendTextMessage.mockRejectedValueOnce(transient());

      await runToCompletion(buildJob());

      const [first, second] = whatsapp.sendTextMessage.mock.calls;
      expect(second).toEqual(first);
    });

    it("after the 5th failed attempt writes one FAILED row with the error and logs it", async () => {
      whatsapp.sendTextMessage.mockRejectedValue(transient());
      const job = buildJob();

      const { error } = await runToCompletion(job);

      expect(error).toBeInstanceOf(WhatsAppTransientError);
      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(5);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        jobId: JOB_DATA.idempotencyKey,
        status: "FAILED",
        channel: "WHATSAPP",
        error: "WHATSAPP_TRANSIENT (HTTP 503): upstream unavailable",
      });
      const finalLog = errorLog.mock.calls.map((c) => String(c[0])).join("\n");
      expect(finalLog).toContain(`job=${job.id}`);
      expect(finalLog).toContain("user=user-1");
      expect(finalLog).toContain("template=WORKOUT_LINK");
      expect(finalLog).toContain("attempts=5");
      expect(finalLog).toContain("httpStatus=503");
    });

    it("honours the attempts option of the job", async () => {
      whatsapp.sendTextMessage.mockRejectedValue(transient());
      const job = buildJob();
      job.opts.attempts = 2;

      await runToCompletion(job);

      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(1);
    });
  });

  describe("non-retryable failures", () => {
    it.each([
      [
        "InvalidRecipientError",
        new InvalidRecipientError("Número de telefone inválido: 123"),
        "INVALID_RECIPIENT: Número de telefone inválido: 123",
      ],
      [
        "WhatsAppInstanceError",
        new WhatsAppInstanceError("instance does not exist", 404),
        "WHATSAPP_INSTANCE_UNAVAILABLE (HTTP 404): instance does not exist",
      ],
      [
        "WhatsAppNotConnectedError",
        new WhatsAppNotConnectedError("instance name is not configured"),
        "WHATSAPP_NOT_CONNECTED: instance name is not configured",
      ],
    ])(
      "%s fails the job on the first attempt with one FAILED row",
      async (_name, deliveryError, logEntry) => {
        whatsapp.sendTextMessage.mockRejectedValue(deliveryError);

        const { error } = await runToCompletion(buildJob());

        expect(error).toBeInstanceOf(UnrecoverableError);
        expect(error?.message).toBe(logEntry);
        expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
        expect(rows).toEqual([
          expect.objectContaining({ status: "FAILED", error: logEntry }),
        ]);
        expect(errorLog).toHaveBeenCalled();
      },
    );

    it("marks the user DISCONNECTED only for WhatsAppInstanceError", async () => {
      whatsapp.sendTextMessage.mockRejectedValueOnce(
        new WhatsAppInstanceError("logged out", 401),
      );
      await runToCompletion(buildJob());
      expect(users.setWhatsappConnection).toHaveBeenCalledWith("user-1", {
        status: "DISCONNECTED",
      });

      users.setWhatsappConnection.mockClear();
      rows.length = 0;
      whatsapp.sendTextMessage.mockRejectedValueOnce(
        new InvalidRecipientError("bad phone"),
      );
      await runToCompletion(buildJob());
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });

    it("still writes the FAILED row when marking DISCONNECTED fails, and logs it", async () => {
      whatsapp.sendTextMessage.mockRejectedValue(
        new WhatsAppInstanceError("logged out", 401),
      );
      users.setWhatsappConnection.mockRejectedValue(new Error("db down"));

      const { error } = await runToCompletion(buildJob());

      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(rows).toHaveLength(1);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("Could not mark user user-1 DISCONNECTED"),
        expect.any(String),
      );
    });
  });

  describe("disconnected WhatsApp", () => {
    it.each([
      [{ instanceName: "user-abc12345", status: "DISCONNECTED" }],
      [{ instanceName: "user-abc12345", status: "PENDING" }],
      [{ instanceName: null, status: "CONNECTED" }],
    ])("does not send with connection %j", async (connection) => {
      users.getWhatsappConnection.mockResolvedValue(connection);

      const { error } = await runToCompletion(buildJob());

      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("FAILED");
      expect(rows[0].channel).toBe("WHATSAPP");
      expect(rows[0].error).toMatch(/^WHATSAPP_NOT_CONNECTED: /);
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });
  });

  describe("duplicate job", () => {
    it("the same job processed twice sends once and leaves one row", async () => {
      const job = buildJob();

      await processor.process(asJob(job));
      const second = await processor.process(asJob(buildJob()));

      expect(second).toBe("ALREADY_RECORDED");
      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    });

    it("tolerates P2002 on the audit insert (two workers racing on one job)", async () => {
      audit.findByJobId.mockResolvedValue(null);
      audit.record.mockResolvedValue(null);

      await expect(processor.process(asJob(buildJob()))).resolves.toBe("SENT");
    });

    it("a FAILED job re-delivered after a crash is not sent again", async () => {
      whatsapp.sendTextMessage.mockRejectedValueOnce(
        new InvalidRecipientError("bad phone"),
      );
      await runToCompletion(buildJob());

      const again = await processor.process(asJob(buildJob()));

      expect(again).toBe("ALREADY_RECORDED");
      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    });
  });

  describe("delivered but not yet recorded", () => {
    it("retries only the audit insert, never the send", async () => {
      const dbDown = new Error("connection refused");
      audit.record.mockRejectedValueOnce(dbDown);
      const job = buildJob();

      await expect(processor.process(asJob(job))).rejects.toBe(dbDown);
      expect(job.updateProgress).toHaveBeenCalledWith({ delivered: true });
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("Could not write the SENT audit row"),
        expect.any(String),
      );

      job.attemptsMade += 1;
      await expect(processor.process(asJob(job))).resolves.toBe("SENT");

      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("SENT");
    });
  });

  describe("do-not-disturb window", () => {
    it("is not checked by the worker: a promoted job is sent at night", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-09-20T05:30:00.000Z"));
      try {
        await expect(processor.process(asJob(buildJob()))).resolves.toBe(
          "SENT",
        );
      } finally {
        jest.useRealTimers();
      }
      expect(users.getSettings).not.toHaveBeenCalled();
      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("unexpected errors", () => {
    it("logs the stack and follows the default retry path", async () => {
      const bug = new TypeError("cannot read properties of undefined");
      whatsapp.sendTextMessage.mockRejectedValueOnce(bug);

      await expect(processor.process(asJob(buildJob()))).rejects.toBe(bug);

      expect(rows).toHaveLength(0);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected error in job"),
        bug.stack,
      );
    });

    it("writes one FAILED row after the last attempt", async () => {
      whatsapp.sendTextMessage.mockRejectedValue(new Error("boom"));

      const { error } = await runToCompletion(buildJob());

      expect(error?.message).toBe("boom");
      expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(5);
      expect(rows).toEqual([
        expect.objectContaining({
          status: "FAILED",
          error: "UNEXPECTED_ERROR: boom",
        }),
      ]);
    });

    it("surfaces a failed FAILED-row insert instead of hiding it", async () => {
      whatsapp.sendTextMessage.mockRejectedValue(
        new InvalidRecipientError("bad phone"),
      );
      const dbDown = new Error("connection refused");
      audit.record.mockRejectedValue(dbDown);

      await expect(processor.process(asJob(buildJob()))).rejects.toBe(dbDown);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("Could not write the FAILED audit row"),
        expect.any(String),
      );
    });
  });
});
