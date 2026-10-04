/**
 * Security-review regression M3 against a real Redis: a trainer's pending views are
 * read through the per-trainer job index, so other tenants' jobs cannot hide them.
 */
import { getQueueToken } from "@nestjs/bullmq";
import { WhatsappStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { utcToZonedTime } from "date-fns-tz";

import { NOTIFICATION_SENDER, NotificationSender } from "../src/common/ports";
import { NOTIFICATIONS_QUEUE, NotificationJobData } from "../src/common/types";
import { PendingJobIndex } from "../src/modules/messaging/pending-job-index.service";
import {
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
  unique,
  waitFor,
} from "./support/e2e-app";

const TIMEZONE = "America/Sao_Paulo";
const CROWD = 1001;

describe("Pending notifications behind another tenant's backlog (e2e)", () => {
  let e2e: E2eApp;
  let queue: Queue<NotificationJobData>;
  let sender: NotificationSender;
  let index: PendingJobIndex;
  let alice: Trainer;
  let bob: Trainer;
  const jobIds: string[] = [];

  const enqueue = async (trainer: Trainer) => {
    const idempotencyKey = unique("review");
    jobIds.push(idempotencyKey);
    await sender.enqueue({
      userId: trainer.id,
      clientId: null,
      recipientPhone: "+5553999990000",
      templateType: "WORKOUT_LINK",
      params: { name: "Ana", link: "https://app.test/p/x?token=y" },
      idempotencyKey,
    });
    return idempotencyKey;
  };

  /** Do-not-disturb off (send now) or a window that contains the current hour (delay). */
  const setDnd = (trainer: Trainer, silent: boolean) => {
    const hour = utcToZonedTime(new Date(), TIMEZONE).getHours();
    return e2e
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
  };

  const indexedIds = async (trainer: Trainer) =>
    (await index.entries(trainer.id)).map((entry) => entry.jobId);

  beforeAll(async () => {
    e2e = await createE2eApp();
    queue = e2e.app.get(getQueueToken(NOTIFICATIONS_QUEUE));
    sender = e2e.app.get<NotificationSender>(NOTIFICATION_SENDER);
    index = e2e.app.get(PendingJobIndex);
    alice = await signUpTrainer(e2e, "reviewalice");
    bob = await signUpTrainer(e2e, "reviewbob");
    for (const trainer of [alice, bob]) {
      await e2e.prisma.user.update({
        where: { id: trainer.id },
        data: {
          whatsappStatus: WhatsappStatus.CONNECTED,
          whatsappInstanceName: unique("e2e-review-instance-"),
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    // Only this suite's jobs and index entries are removed.
    for (const id of jobIds) {
      const job = await queue.getJob(id);
      if (job) await job.remove();
    }
    for (const trainer of [alice, bob]) {
      for (const id of await indexedIds(trainer)) {
        await index.remove(trainer.id, id);
      }
    }
    await removeTrainers(e2e, [alice, bob]);
    await e2e.app.close();
  }, 60_000);

  it("shows, counts, flushes and cancels a trainer's jobs although another tenant holds 1,001 newer delayed jobs", async () => {
    await setDnd(alice, true);
    await setDnd(bob, true);
    const first = await enqueue(alice);
    const second = await enqueue(alice);
    for (let i = 0; i < CROWD; i++) await enqueue(bob);

    const pending = await e2e
      .http()
      .get("/api/messaging/pending")
      .set(alice.auth)
      .expect(200);
    expect(
      pending.body.map((job: { jobId: string }) => job.jobId).sort(),
    ).toEqual([first, second].sort());
    const logs = await e2e
      .http()
      .get("/api/messaging/logs")
      .set(alice.auth)
      .expect(200);
    expect(logs.body.summary.totalPending).toBe(2);
    const bobLogs = await e2e
      .http()
      .get("/api/messaging/logs")
      .set(bob.auth)
      .expect(200);
    expect(bobLogs.body.summary.totalPending).toBe(CROWD);

    // cancelling removes the entry at once
    await e2e
      .http()
      .delete(`/api/messaging/pending/${first}`)
      .set(alice.auth)
      .expect(200);
    expect(await indexedIds(alice)).toEqual([second]);

    // flushing sends the other one; the worker's completed event empties the index
    const flushed = await e2e
      .http()
      .post("/api/messaging/pending/flush")
      .set(alice.auth)
      .expect(200);
    expect(flushed.body.promotedCount).toBe(1);
    await waitFor(
      async () => (await indexedIds(alice)).length === 0,
      "the worker to remove the sent job from the index",
    );
    expect(
      await e2e.prisma.notificationLog.findUnique({ where: { jobId: second } }),
    ).toMatchObject({ status: "SENT" });
  }, 120_000);
});
