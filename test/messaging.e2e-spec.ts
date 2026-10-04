/**
 * Messaging against a real Redis (BullMQ) and a real database (contract 6.6, 9).
 * WhatsAppService is a stub that records what would be sent: nothing leaves the process.
 * Replaces the obsolete messaging-queue suite (routes /messaging/queue* are gone).
 */
import { getQueueToken } from "@nestjs/bullmq";
import { WhatsappStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { utcToZonedTime } from "date-fns-tz";

import { NOTIFICATION_SENDER, NotificationSender } from "../src/common/ports";
import {
  NOTIFICATION_JOB_OPTIONS,
  NOTIFICATIONS_QUEUE,
  NotificationJobData,
  SEND_NOTIFICATION_JOB,
} from "../src/common/types";
import {
  createClient,
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
  unique,
  waitFor,
} from "./support/e2e-app";

const TIMEZONE = "America/Sao_Paulo";

describe("Messaging queue and audit trail (e2e)", () => {
  let e2e: E2eApp;
  let queue: Queue<NotificationJobData>;
  let alice: Trainer;
  let bob: Trainer;
  const instanceOf = new Map<string, string>();

  beforeAll(async () => {
    e2e = await createE2eApp();
    queue = e2e.app.get(getQueueToken(NOTIFICATIONS_QUEUE));
    alice = await signUpTrainer(e2e, "alice");
    bob = await signUpTrainer(e2e, "bob");
    for (const trainer of [alice, bob]) await connect(trainer);
  });

  afterAll(async () => {
    // Only this suite's jobs are removed; the queue itself is left alone.
    const jobs = await queue.getJobs([
      "delayed",
      "waiting",
      "completed",
      "failed",
    ]);
    const mine = jobs.filter((job) =>
      [alice?.id, bob?.id].includes(job.data.userId),
    );
    await Promise.all(mine.map((job) => job.remove()));
    await removeTrainers(e2e, [alice, bob]);
    await e2e.app.close();
  });

  async function connect(trainer: Trainer): Promise<void> {
    const instanceName = unique("e2e-instance-");
    instanceOf.set(trainer.id, instanceName);
    await e2e.prisma.user.update({
      where: { id: trainer.id },
      data: {
        whatsappStatus: WhatsappStatus.CONNECTED,
        whatsappInstanceName: instanceName,
      },
    });
  }

  /** Do-not-disturb off (send now) or a window that contains the current hour (delay). */
  async function setDnd(trainer: Trainer, silent: boolean): Promise<void> {
    const hour = utcToZonedTime(new Date(), TIMEZONE).getHours();
    await e2e
      .http()
      .patch("/api/settings/dnd")
      .set(trainer.auth)
      .send({
        enabled: silent,
        startHour: hour,
        endHour: (hour + 2) % 24,
        timezone: TIMEZONE,
      })
      .expect(200);
  }

  const requestAnamnesis = async (trainer: Trainer, clientId: string) => {
    const res = await e2e
      .http()
      .post(`/api/anamnesis/student/${clientId}/request-reassessment`)
      .set(trainer.auth)
      .expect(201);
    return res.body.notification as {
      jobId: string;
      scheduledDelayMs: number;
    };
  };

  const pendingOf = async (trainer: Trainer) => {
    const res = await e2e
      .http()
      .get("/api/messaging/pending")
      .set(trainer.auth)
      .expect(200);
    return res.body as Array<{ jobId: string; state: string }>;
  };

  const logsOf = (trainer: Trainer) =>
    e2e.prisma.notificationLog.findMany({ where: { userId: trainer.id } });

  const rowOf = (jobId: string) =>
    waitFor(
      () => e2e.prisma.notificationLog.findUnique({ where: { jobId } }),
      `the audit row of job ${jobId}`,
    );

  const sentBy = (trainer: Trainer) =>
    e2e.whatsapp.sent.filter(
      (message) => message.instanceName === instanceOf.get(trainer.id),
    );

  describe("delivery and idempotency", () => {
    it("sends once and writes exactly one SENT row; a duplicate key and a re-delivered job add nothing", async () => {
      await setDnd(alice, false);
      const client = await createClient(e2e, alice, {
        phone: "+5553999991111",
      });

      const { jobId, scheduledDelayMs } = await requestAnamnesis(
        alice,
        client.id,
      );

      expect(scheduledDelayMs).toBe(0);
      const row = await rowOf(jobId);
      expect(row).toMatchObject({
        status: "SENT",
        channel: "WHATSAPP",
        templateType: "WELCOME_ANAMNESIS",
        clientId: client.id,
        recipientPhone: "+5553999991111",
        error: null,
      });
      expect(sentBy(alice)).toHaveLength(1);
      expect(sentBy(alice)[0].text).toContain("/#/anamnesis?token=");

      // 1. Same idempotency key again: BullMQ still knows the job.
      const sender = e2e.app.get<NotificationSender>(NOTIFICATION_SENDER);
      const job = await queue.getJob(jobId);
      const again = await sender.enqueue({
        userId: alice.id,
        clientId: client.id,
        recipientPhone: client.phone,
        templateType: "WELCOME_ANAMNESIS",
        params: job!.data.params,
        idempotencyKey: jobId,
      });
      expect(again.status).toBe("DUPLICATE");

      // 2. The same notification delivered again as a new job (BullMQ forgot the first one).
      const redelivered = await queue.add(SEND_NOTIFICATION_JOB, job!.data, {
        ...NOTIFICATION_JOB_OPTIONS,
        jobId: unique("redelivered"),
      });
      await waitFor(
        async () => (await queue.getJob(redelivered.id!))?.isCompleted(),
        "the re-delivered job to finish",
      );

      expect(sentBy(alice)).toHaveLength(1);
      expect(await logsOf(alice)).toHaveLength(1);
      const history = await e2e
        .http()
        .get(`/api/clients/${client.id}/messages`)
        .set(alice.auth)
        .expect(200);
      expect(history.body.map((r: { jobId: string }) => r.jobId)).toEqual([
        jobId,
      ]);
    });

    it("the workout link requested twice in one minute is one job, one message, one row", async () => {
      await setDnd(bob, false);
      const client = await createClient(e2e, bob);
      const send = () =>
        e2e
          .http()
          .post(`/api/clients/${client.id}/magic-link/send`)
          .set(bob.auth)
          .expect(200);

      let [first, second] = [await send(), await send()];
      if (first.body.jobId !== second.body.jobId) {
        // The two calls straddled a UTC minute (the key carries the minute): take the next pair.
        [first, second] = [second, await send()];
      }

      expect(second.body.jobId).toBe(first.body.jobId);
      expect(second.body).toMatchObject({
        status: "QUEUED",
        channel: "WHATSAPP",
      });
      const row = await rowOf(first.body.jobId);
      expect(row.status).toBe("SENT");
      const links = sentBy(bob).filter((m) => m.text.includes(first.body.link));
      expect(links).toHaveLength(1);
      expect(
        await e2e.prisma.notificationLog.count({
          where: { jobId: first.body.jobId },
        }),
      ).toBe(1);
    });

    it("a trainer without a WhatsApp connection gets one FAILED row and nothing is sent", async () => {
      const carol = await signUpTrainer(e2e, "carol");
      try {
        await setDnd(carol, false);
        const client = await createClient(e2e, carol);

        const { jobId } = await requestAnamnesis(carol, client.id);

        const row = await rowOf(jobId);
        expect(row.status).toBe("FAILED");
        expect(row.error).toMatch(/^WHATSAPP_NOT_CONNECTED/);
        const job = await queue.getJob(jobId);
        expect(job?.attemptsMade).toBe(1);
        await job?.remove();
      } finally {
        await removeTrainers(e2e, [carol]);
      }
    });
  });

  describe("pending list, flush and cancel", () => {
    it("flush promotes only the caller's delayed jobs; cancel is limited to the owner", async () => {
      await setDnd(alice, true);
      await setDnd(bob, true);
      const aliceClient = await createClient(e2e, alice);
      const bobClient = await createClient(e2e, bob, {
        phone: "+5553999992222",
      });
      const aliceLogsBefore = (await logsOf(alice)).length;
      const bobLogsBefore = (await logsOf(bob)).length;

      const aliceJob = await requestAnamnesis(alice, aliceClient.id);
      const bobJob = await requestAnamnesis(bob, bobClient.id);

      // Inside do-not-disturb: delayed, listed per trainer, nothing audited yet.
      expect(aliceJob.scheduledDelayMs).toBeGreaterThan(0);
      expect(await pendingOf(alice)).toMatchObject([
        { jobId: aliceJob.jobId, state: "delayed" },
      ]);
      expect(await pendingOf(bob)).toMatchObject([
        { jobId: bobJob.jobId, state: "delayed" },
      ]);
      expect(await logsOf(alice)).toHaveLength(aliceLogsBefore);
      const logs = await e2e
        .http()
        .get("/api/messaging/logs")
        .set(alice.auth)
        .expect(200);
      expect(logs.body.summary.totalPending).toBe(1);

      const flushed = await e2e
        .http()
        .post("/api/messaging/pending/flush")
        .set(alice.auth)
        .expect(200);

      expect(flushed.body.promotedCount).toBe(1);
      expect((await rowOf(aliceJob.jobId)).status).toBe("SENT");
      expect(await pendingOf(alice)).toEqual([]);
      // Bob's job did not move.
      expect(await pendingOf(bob)).toMatchObject([
        { jobId: bobJob.jobId, state: "delayed" },
      ]);
      expect(await logsOf(bob)).toHaveLength(bobLogsBefore);

      // Alice cannot cancel Bob's job; Bob can, and it is audited as CANCELLED.
      await e2e
        .http()
        .delete(`/api/messaging/pending/${bobJob.jobId}`)
        .set(alice.auth)
        .expect(404);
      const cancelled = await e2e
        .http()
        .delete(`/api/messaging/pending/${bobJob.jobId}`)
        .set(bob.auth)
        .expect(200);
      expect(cancelled.body.notification).toMatchObject({
        jobId: bobJob.jobId,
        status: "CANCELLED",
        error: "Cancelado manualmente pelo treinador.",
      });
      expect(await pendingOf(bob)).toEqual([]);
      expect(e2e.whatsapp.sent.some((m) => m.phone === "+5553999992222")).toBe(
        false,
      );
    });
  });

  describe("guards", () => {
    it("rejects the removed QUEUED status filter and requires a token", async () => {
      await e2e
        .http()
        .get("/api/messaging/logs")
        .query({ status: "QUEUED" })
        .set(alice.auth)
        .expect(400);
      await e2e.http().get("/api/messaging/pending").expect(401);
    });
  });
});
