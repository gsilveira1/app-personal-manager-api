import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { WhatsappStatus } from "@prisma/client";
import { Job, UnrecoverableError } from "bullmq";
import { USER_DIRECTORY, UserDirectory } from "../../common/ports";
import {
  NotificationDeliveryError,
  NotificationJobData,
  NOTIFICATIONS_QUEUE,
  WhatsAppInstanceError,
  WhatsAppNotConnectedError,
} from "../../common/types";
import { formatMessage } from "./message-templates";
import { NotificationAuditService } from "./notification-audit.service";
import { PendingJobIndex } from "./pending-job-index.service";
import { WhatsAppService } from "./whatsapp.service";

export const NOTIFICATION_WORKER_CONCURRENCY = 5;

/** Stored as the job's progress once the provider accepted the message. */
const DELIVERED_MARK = { delivered: true } as const;

export type NotificationJob = Job<NotificationJobData>;
export type ProcessResult = "SENT" | "ALREADY_RECORDED";

function wasDelivered(job: NotificationJob): boolean {
  const progress: unknown = job.progress;
  return (
    typeof progress === "object" &&
    progress !== null &&
    (progress as { delivered?: unknown }).delivered === true
  );
}

function isLastAttempt(job: NotificationJob): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

function describeFailure(error: Error): string {
  return error instanceof NotificationDeliveryError
    ? error.toLogEntry()
    : `UNEXPECTED_ERROR: ${error.message}`;
}

/**
 * Worker of the `notifications` queue. Sends one WhatsApp message per job and
 * writes exactly one NotificationLog row with the final outcome.
 *
 * Idempotency: a job whose outcome is already recorded is not sent again; a job
 * that was delivered but whose audit insert failed is retried without re-sending.
 * The do-not-disturb window is not checked here — it was applied as the job delay.
 */
@Processor(NOTIFICATIONS_QUEUE, {
  concurrency: NOTIFICATION_WORKER_CONCURRENCY,
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    private readonly whatsapp: WhatsAppService,
    private readonly audit: NotificationAuditService,
    private readonly index: PendingJobIndex,
  ) {
    super();
  }

  /** A finished job leaves the trainer's pending-job index. */
  @OnWorkerEvent("completed")
  async onCompleted(job: NotificationJob): Promise<void> {
    await this.unindex(job);
  }

  /**
   * BullMQ emits `failed` after every failed attempt; only a job that will not be
   * retried (state `failed`) leaves the index.
   */
  @OnWorkerEvent("failed")
  async onFailed(job: NotificationJob | undefined): Promise<void> {
    if (!job) return; // BullMQ could not load the job: there is nothing to unindex
    await this.unindex(job, "failed");
  }

  /**
   * Runs in an event listener, where a rejection would be unhandled: a failure is
   * logged, and the entry is dropped by the next read of the trainer's pending jobs.
   */
  private async unindex(job: NotificationJob, onlyInState?: string) {
    try {
      if (onlyInState && (await job.getState()) !== onlyInState) return;
      await this.index.remove(job.data.userId, String(job.id));
    } catch (thrown) {
      const error = toError(thrown);
      this.logger.error(
        `Could not remove finished job ${job.id} from the pending-job index of user ${job.data.userId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * @throws {WhatsAppTransientError} Retryable failure with attempts left (BullMQ retries with backoff)
   * @throws {UnrecoverableError} Non-retryable delivery failure (the FAILED row is already written)
   * @throws {Error} Unexpected failure, or the audit row could not be written
   */
  async process(job: NotificationJob): Promise<ProcessResult> {
    const { data } = job;
    const recorded = await this.audit.findByJobId(data.idempotencyKey);
    if (recorded) {
      this.logger.warn(
        `Job ${job.id} re-delivered after its outcome (${recorded.status}) was recorded; nothing sent`,
      );
      return "ALREADY_RECORDED";
    }

    if (!wasDelivered(job)) {
      try {
        await this.deliver(data);
      } catch (thrown) {
        throw await this.handleFailure(job, toError(thrown));
      }
      await job.updateProgress(DELIVERED_MARK);
    }
    await this.recordOutcome(job, "SENT", null);
    return "SENT";
  }

  private async deliver(data: NotificationJobData): Promise<void> {
    const connection = await this.users.getWhatsappConnection(data.userId);
    if (
      connection.status !== WhatsappStatus.CONNECTED ||
      !connection.instanceName
    ) {
      throw new WhatsAppNotConnectedError(
        `WhatsApp do treinador não está conectado (status ${connection.status}).`,
      );
    }
    const text = formatMessage(data.templateType, data.params);
    await this.whatsapp.sendTextMessage(
      connection.instanceName,
      data.recipientPhone,
      text,
    );
  }

  /** Decides between "retry" and "final failure". Returns the error the job must fail with. */
  private async handleFailure(
    job: NotificationJob,
    error: Error,
  ): Promise<Error> {
    const known = error instanceof NotificationDeliveryError ? error : null;
    if (!known) {
      this.logger.error(
        `Unexpected error in job ${job.id} (user ${job.data.userId}, ${job.data.templateType}): ${error.message}`,
        error.stack,
      );
    }
    if (known instanceof WhatsAppInstanceError) {
      await this.markDisconnected(job, known);
    }

    const unrecoverable = known !== null && !known.retryable;
    if (!unrecoverable && !isLastAttempt(job)) {
      this.logger.warn(
        `Job ${job.id} attempt ${job.attemptsMade + 1}/${job.opts.attempts} failed, will retry: ${describeFailure(error)}`,
      );
      return error;
    }

    await this.recordOutcome(job, "FAILED", describeFailure(error));
    this.logFinalFailure(job, error);
    return unrecoverable
      ? new UnrecoverableError(describeFailure(error))
      : error;
  }

  private async markDisconnected(
    job: NotificationJob,
    cause: WhatsAppInstanceError,
  ): Promise<void> {
    const { userId } = job.data;
    try {
      await this.users.setWhatsappConnection(userId, {
        status: WhatsappStatus.DISCONNECTED,
      });
    } catch (thrown) {
      // The FAILED audit row matters more than the status flag: log and go on.
      // GET /whatsapp/status reconciles the stored status on its next call.
      const error = toError(thrown);
      this.logger.error(
        `Could not mark user ${userId} DISCONNECTED after ${cause.toLogEntry()} (job ${job.id}): ${error.message}`,
        error.stack,
      );
    }
  }

  private async recordOutcome(
    job: NotificationJob,
    status: "SENT" | "FAILED",
    error: string | null,
  ): Promise<void> {
    const { data } = job;
    try {
      const row = await this.audit.record({
        jobId: data.idempotencyKey,
        userId: data.userId,
        clientId: data.clientId,
        recipientPhone: data.recipientPhone,
        templateType: data.templateType,
        channel: data.channel,
        status,
        error,
      });
      if (!row) {
        this.logger.warn(`Outcome of job ${job.id} was already recorded`);
      }
    } catch (thrown) {
      const auditError = toError(thrown);
      this.logger.error(
        `Could not write the ${status} audit row of job ${job.id} (user ${data.userId}${error ? `, ${error}` : ""}): ${auditError.message}`,
        auditError.stack,
      );
      throw auditError;
    }
  }

  private logFinalFailure(job: NotificationJob, error: Error): void {
    const httpStatus =
      error instanceof NotificationDeliveryError ? error.httpStatus : undefined;
    this.logger.error(
      `Notification failed permanently: job=${job.id} user=${job.data.userId} ` +
        `template=${job.data.templateType} attempts=${job.attemptsMade + 1} ` +
        `httpStatus=${httpStatus ?? "n/a"} error=${describeFailure(error)}`,
      error.stack,
    );
  }
}
