import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { NOTIFICATIONS_QUEUE, NotificationJobData } from "../../common/types";

/**
 * How long an entry whose job does not exist is kept. The entry is written before the
 * job, so for a moment it points at nothing; only an older entry is really stale.
 */
export const INDEX_GRACE_MS = 60_000;

export interface IndexedJob {
  jobId: string;
  /** Epoch ms of the (last) time the id was added. */
  addedAt: number;
}

/**
 * Per-trainer index of the ids of jobs that have not finished: one Redis hash per
 * user (job id → time added), next to the queue's own keys. It lets the pending views read a trainer's
 * jobs by id instead of scanning the jobs of every tenant.
 *
 * Lifecycle: the id is added before the job is queued, and removed when the job
 * completes, fails for good or is cancelled. A removal that is missed leaves an entry
 * that readers drop (see `PendingNotificationsService`), so the index never has to be
 * exact, only a superset of the trainer's pending jobs.
 *
 * Methods reject when Redis fails; callers decide between 503 and logging.
 */
@Injectable()
export class PendingJobIndex {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue<NotificationJobData>,
  ) {}

  /**
   * Idempotent: adding an id again only refreshes its time.
   *
   * @example
   * await index.add(userId, jobId); // then queue.add(..., { jobId })
   */
  async add(userId: string, jobId: string, now = Date.now()): Promise<void> {
    const redis = await this.queue.client;
    await redis.hset(this.keyOf(userId), { [jobId]: now });
  }

  async remove(userId: string, jobId: string): Promise<void> {
    const redis = await this.queue.client;
    await redis.hdel(this.keyOf(userId), jobId);
  }

  /** Every id indexed for the user, oldest first. */
  async entries(userId: string): Promise<IndexedJob[]> {
    const redis = await this.queue.client;
    const stored = await redis.hgetall(this.keyOf(userId));
    return Object.entries(stored)
      .map(([jobId, addedAt]) => ({ jobId, addedAt: Number(addedAt) }))
      .sort((a, b) => a.addedAt - b.addedAt);
  }

  /** Under the queue's prefix, so obliterating the queue also drops the index. */
  private keyOf(userId: string): string {
    return this.queue.toKey(`pending-by-user:${userId}`);
  }
}
