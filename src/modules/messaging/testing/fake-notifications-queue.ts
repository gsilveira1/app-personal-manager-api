import { NotificationJobData } from "../../../common/types";

/** In-memory stand-in for the hash commands the pending-job index uses. */
export class FakeRedis {
  readonly hashes = new Map<string, Map<string, string>>();

  hset = jest.fn(async (key: string, data: Record<string, string | number>) => {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    Object.entries(data).forEach(([field, value]) =>
      hash.set(field, String(value)),
    );
    this.hashes.set(key, hash);
    return Object.keys(data).length;
  });

  hdel = jest.fn(async (key: string, field: string) =>
    this.hashes.get(key)?.delete(field) ? 1 : 0,
  );

  hgetall = jest.fn(async (key: string) =>
    Object.fromEntries(this.hashes.get(key) ?? []),
  );
}

export interface FakeQueueJob {
  id: string;
  data: NotificationJobData;
  timestamp: number;
  delay: number;
  attemptsMade: number;
  state: string;
  getState: jest.Mock<Promise<string>>;
  promote: jest.Mock<Promise<void>>;
  remove: jest.Mock<Promise<void>>;
}

/**
 * In-memory stand-in for the BullMQ queue, for unit tests only. Like BullMQ, `getJobs`
 * reads a slice of ALL tenants' jobs (newest first), and adding a job id twice is a no-op.
 */
export class FakeNotificationsQueue {
  readonly redis = new FakeRedis();
  readonly client = Promise.resolve(this.redis);
  private readonly jobs: FakeQueueJob[] = [];

  toKey = (type: string) => `bull:notifications:${type}`;

  add = jest.fn(
    async (
      _name: string,
      data: NotificationJobData,
      opts: { jobId: string; delay?: number },
    ) => this.find(opts.jobId) ?? this.insert(data, opts),
  );

  getJob = jest.fn(async (id: string) => this.find(id));

  getJobs = jest.fn(
    async ([state]: string[], start = 0, end = -1, asc = false) => {
      const inState = this.jobs.filter((job) => job.state === state);
      const ordered = asc ? inState : [...inState].reverse();
      return ordered.slice(start, end < 0 ? undefined : end + 1);
    },
  );

  /** Moves a job to another state, as a worker would. */
  setState(id: string, state: string): void {
    const job = this.find(id);
    if (!job) throw new Error(`FakeNotificationsQueue: no job ${id}`);
    job.state = state;
  }

  private find(id: string): FakeQueueJob | undefined {
    return this.jobs.find((job) => job.id === id);
  }

  private insert(
    data: NotificationJobData,
    opts: { jobId: string; delay?: number },
  ): FakeQueueJob {
    const job: FakeQueueJob = {
      id: opts.jobId,
      data,
      timestamp: Date.now(),
      delay: opts.delay ?? 0,
      attemptsMade: 0,
      state: opts.delay ? "delayed" : "waiting",
      getState: jest.fn(async () => job.state),
      promote: jest.fn(async () => {
        job.state = "waiting";
      }),
      remove: jest.fn(async () => {
        this.jobs.splice(this.jobs.indexOf(job), 1);
        job.state = "unknown";
      }),
    };
    this.jobs.push(job);
    return job;
  }
}
