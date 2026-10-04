import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import {
  EnqueueNotificationRequest,
  EnqueueNotificationResult,
  NotificationSender,
  USER_DIRECTORY,
  UserDirectory,
} from "../../common/ports";
import {
  NOTIFICATION_JOB_OPTIONS,
  NOTIFICATIONS_QUEUE,
  NotificationJobData,
  SEND_NOTIFICATION_JOB,
} from "../../common/types";
import { calculateDndDelayMs } from "./dnd";
import { PendingJobIndex } from "./pending-job-index.service";
import { callQueue } from "./queue-access";

/** Time left until a job that is already queued becomes due. */
function remainingDelayMs(job: Job<NotificationJobData>, now: Date): number {
  return Math.max(0, job.timestamp + (job.delay ?? 0) - now.getTime());
}

/**
 * Implementation of the NOTIFICATION_SENDER port: puts a `send` job on the
 * `notifications` queue and its id in the trainer's pending-job index. Writes nothing
 * to NotificationLog.
 */
@Injectable()
export class NotificationSenderService implements NotificationSender {
  private readonly logger = new Logger(NotificationSenderService.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue<NotificationJobData>,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    private readonly index: PendingJobIndex,
  ) {}

  /**
   * @returns `ENQUEUED`, or `DUPLICATE` when a job with the same idempotency key exists
   * @throws {NotFoundException} When the user does not exist (from UserDirectory)
   * @throws {ServiceUnavailableException} When Redis cannot be reached
   */
  async enqueue(
    request: EnqueueNotificationRequest,
  ): Promise<EnqueueNotificationResult> {
    const now = new Date();
    const jobId = request.idempotencyKey;
    const delay = await this.resolveDelay(request, now);

    const existing = await callQueue(this.logger, `getJob ${jobId}`, () =>
      this.queue.getJob(jobId),
    );
    if (existing) {
      this.logger.log(
        `Notification ${jobId} (${request.templateType}) already queued; skipping duplicate`,
      );
      return {
        jobId,
        status: "DUPLICATE",
        scheduledDelayMs: remainingDelayMs(existing, now),
      };
    }

    // Index first: if the job is then not added, readers drop the entry. The other
    // order could leave a queued job that the trainer's pending views never show.
    await callQueue(
      this.logger,
      `index ${jobId} for user ${request.userId}`,
      () => this.index.add(request.userId, jobId, now.getTime()),
    );
    await callQueue(this.logger, `add ${jobId}`, () =>
      this.queue.add(SEND_NOTIFICATION_JOB, this.buildJobData(request, now), {
        ...NOTIFICATION_JOB_OPTIONS,
        jobId,
        delay,
      }),
    );
    return { jobId, status: "ENQUEUED", scheduledDelayMs: delay };
  }

  private async resolveDelay(
    request: EnqueueNotificationRequest,
    now: Date,
  ): Promise<number> {
    if (request.bypassDnd) {
      return 0;
    }
    const settings = await this.users.getSettings(request.userId);
    return calculateDndDelayMs(now, settings.dnd);
  }

  private buildJobData(
    request: EnqueueNotificationRequest,
    now: Date,
  ): NotificationJobData {
    return {
      version: 1,
      idempotencyKey: request.idempotencyKey,
      userId: request.userId,
      clientId: request.clientId,
      recipientPhone: request.recipientPhone,
      channel: "WHATSAPP",
      templateType: request.templateType,
      params: request.params,
      requestedAt: now.toISOString(),
    };
  }
}
