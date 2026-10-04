import { InjectQueue } from "@nestjs/bullmq";
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NotificationLog } from "@prisma/client";
import { Job, Queue } from "bullmq";
import { NOTIFICATIONS_QUEUE, NotificationJobData } from "../../common/types";
import { NotificationAuditService } from "./notification-audit.service";
import {
  INDEX_GRACE_MS,
  IndexedJob,
  PendingJobIndex,
} from "./pending-job-index.service";
import { callQueue, QUEUE_UNAVAILABLE_MESSAGE } from "./queue-access";

export const PENDING_STATES = ["waiting", "delayed", "active"] as const;
export type PendingState = (typeof PENDING_STATES)[number];

/** States of a job that is over; its index entry is dropped when read. */
const FINISHED_STATES = ["completed", "failed", "unknown"];
export const CANCELLED_BY_TRAINER = "Cancelado manualmente pelo treinador.";

export interface PendingNotificationView {
  jobId: string;
  templateType: string;
  recipientPhone: string;
  clientId: string | null;
  state: PendingState;
  /** When a delayed job becomes due; null when it is not delayed or the time is unknown (retry backoff). */
  scheduledFor: string | null;
  attemptsMade: number;
  requestedAt: string;
}

type NotificationJob = Job<NotificationJobData>;

interface PendingJob {
  job: NotificationJob;
  state: PendingState;
}

const isPendingState = (state: string): state is PendingState =>
  (PENDING_STATES as readonly string[]).includes(state);

function scheduledFor(
  job: NotificationJob,
  state: PendingState,
): string | null {
  // After a failed attempt BullMQ re-delays the job relative to the failure time,
  // which the job hash does not expose; only the first delay can be reported.
  if (state !== "delayed" || job.attemptsMade > 0) {
    return null;
  }
  return new Date(job.timestamp + (job.delay ?? 0)).toISOString();
}

function toView(
  job: NotificationJob,
  state: PendingState,
): PendingNotificationView {
  return {
    jobId: String(job.id),
    templateType: job.data.templateType,
    recipientPhone: job.data.recipientPhone,
    clientId: job.data.clientId,
    state,
    scheduledFor: scheduledFor(job, state),
    attemptsMade: job.attemptsMade,
    requestedAt: job.data.requestedAt,
  };
}

/**
 * Reads and controls the caller's jobs that have not finished yet (BullMQ, not the
 * database). Jobs are found through {@link PendingJobIndex}, never by scanning the queue.
 */
@Injectable()
export class PendingNotificationsService {
  private readonly logger = new Logger(PendingNotificationsService.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue<NotificationJobData>,
    private readonly audit: NotificationAuditService,
    private readonly index: PendingJobIndex,
  ) {}

  /**
   * The caller's jobs in `waiting`, `delayed` or `active`, newest request first.
   *
   * @throws {ServiceUnavailableException} When Redis cannot be reached
   */
  async list(userId: string): Promise<PendingNotificationView[]> {
    const owned = await this.ownedJobs(userId);
    return owned
      .map(({ job, state }) => toView(job, state))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  /**
   * Promotes the caller's delayed jobs: they are sent now, despite do-not-disturb.
   *
   * @throws {ServiceUnavailableException} When Redis cannot be reached or no job could be promoted
   */
  async flush(
    userId: string,
  ): Promise<{ promotedCount: number; message: string }> {
    const delayed = (await this.ownedJobs(userId))
      .filter(({ state }) => state === "delayed")
      .map(({ job }) => job);
    const results = await callQueue(this.logger, "promote", () =>
      Promise.allSettled(delayed.map((job) => job.promote())),
    );
    const failures = results.filter((r) => r.status === "rejected");
    failures.forEach((failure, index) =>
      this.logger.error(
        `Could not promote a delayed job of user ${userId} (${index + 1}/${failures.length}): ${String((failure as PromiseRejectedResult).reason)}`,
      ),
    );
    if (delayed.length > 0 && failures.length === delayed.length) {
      throw new ServiceUnavailableException(QUEUE_UNAVAILABLE_MESSAGE);
    }
    const promotedCount = delayed.length - failures.length;
    return {
      promotedCount,
      message:
        promotedCount === 0
          ? "Nenhuma mensagem aguardando envio."
          : `${promotedCount} mensagem(ns) liberada(s) para envio imediato.`,
    };
  }

  /**
   * Removes a pending job and records it as CANCELLED.
   *
   * @throws {NotFoundException} Unknown job, another trainer's job, or a job that already finished
   * @throws {ConflictException} The job is being sent right now
   * @throws {ServiceUnavailableException} When Redis cannot be reached
   */
  async cancel(
    userId: string,
    jobId: string,
  ): Promise<{ message: string; notification: NotificationLog }> {
    const job = await callQueue(this.logger, `getJob ${jobId}`, () =>
      this.queue.getJob(jobId),
    );
    if (!job || job.data.userId !== userId) {
      throw new NotFoundException("Mensagem pendente não encontrada.");
    }
    await this.removePending(job);
    await this.unindex(userId, jobId);
    const notification = await this.recordCancellation(job);
    return { message: "Mensagem cancelada com sucesso.", notification };
  }

  /** The caller's indexed jobs that are still waiting, delayed or active. */
  private async ownedJobs(userId: string): Promise<PendingJob[]> {
    const resolved = await callQueue(
      this.logger,
      `read pending jobs of user ${userId}`,
      async () => {
        const entries = await this.index.entries(userId);
        return Promise.all(
          entries.map((entry) => this.resolveEntry(userId, entry)),
        );
      },
    );
    return resolved.filter((item): item is PendingJob => item !== null);
  }

  /**
   * The pending job an index entry points at. An entry that points at nothing (after
   * the grace period), at a finished job or at another trainer's job is dropped.
   */
  private async resolveEntry(
    userId: string,
    entry: IndexedJob,
  ): Promise<PendingJob | null> {
    const job: NotificationJob | undefined = await this.queue.getJob(
      entry.jobId,
    );
    if (!job) {
      // The id is indexed before the job is added: a young entry may be mid-enqueue.
      if (Date.now() - entry.addedAt > INDEX_GRACE_MS) {
        await this.index.remove(userId, entry.jobId);
      }
      return null;
    }
    if (job.data.userId !== userId) {
      this.logger.error(
        `Pending-job index of user ${userId} pointed at job ${entry.jobId} of user ${job.data.userId}; entry dropped`,
      );
      await this.index.remove(userId, entry.jobId);
      return null;
    }
    const state = await job.getState();
    if (isPendingState(state)) return { job, state };
    if (FINISHED_STATES.includes(state)) {
      await this.index.remove(userId, entry.jobId);
    }
    return null;
  }

  /**
   * The job is already removed, so a failure here must not fail the cancellation:
   * it is logged, and the entry is dropped by the next read.
   */
  private async unindex(userId: string, jobId: string): Promise<void> {
    try {
      await this.index.remove(userId, jobId);
    } catch (thrown) {
      const error =
        thrown instanceof Error ? thrown : new Error(String(thrown));
      this.logger.error(
        `Could not remove cancelled job ${jobId} from the pending-job index of user ${userId}: ${error.message}`,
        error.stack,
      );
    }
  }

  private stateOf(job: NotificationJob): Promise<string> {
    return callQueue(this.logger, `getState ${job.id}`, () => job.getState());
  }

  private async removePending(job: NotificationJob): Promise<void> {
    const state = await this.stateOf(job);
    if (state === "active") {
      throw new ConflictException(
        "A mensagem já está sendo enviada e não pode ser cancelada.",
      );
    }
    if (state !== "waiting" && state !== "delayed") {
      throw new NotFoundException("Mensagem pendente não encontrada.");
    }
    try {
      await callQueue(this.logger, `remove ${job.id}`, () => job.remove());
    } catch (error) {
      // BullMQ refuses to remove a job a worker picked up in the meantime
      if ((await this.stateOf(job)) === "active") {
        throw new ConflictException(
          "A mensagem já está sendo enviada e não pode ser cancelada.",
        );
      }
      throw error;
    }
  }

  private async recordCancellation(
    job: NotificationJob,
  ): Promise<NotificationLog> {
    const { data } = job;
    const row =
      (await this.audit.record({
        jobId: data.idempotencyKey,
        userId: data.userId,
        clientId: data.clientId,
        recipientPhone: data.recipientPhone,
        templateType: data.templateType,
        channel: data.channel,
        status: "CANCELLED",
        error: CANCELLED_BY_TRAINER,
      })) ?? (await this.audit.findByJobId(data.idempotencyKey));
    if (!row) {
      this.logger.error(
        `Job ${job.id} was removed but its audit row could not be written or found`,
      );
      throw new InternalServerErrorException(
        "Mensagem cancelada, mas o registro de auditoria não foi gravado.",
      );
    }
    return row;
  }
}
