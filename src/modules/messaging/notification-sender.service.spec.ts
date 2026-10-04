import { getQueueToken } from "@nestjs/bullmq";
import {
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EnqueueNotificationRequest, USER_DIRECTORY } from "../../common/ports";
import {
  buildIdempotencyKey,
  DEFAULT_DND,
  NOTIFICATIONS_QUEUE,
} from "../../common/types";
import { NotificationSenderService } from "./notification-sender.service";
import { PendingJobIndex } from "./pending-job-index.service";
import { QUEUE_CALL_TIMEOUT_MS } from "./queue-access";

// 14:00 BRT — outside the default 22h-08h window
const DAYTIME = new Date("2026-09-20T17:00:00.000Z");
// 02:30 BRT — inside it; 5.5 h until 08:00
const NIGHT = new Date("2026-09-20T05:30:00.000Z");
const NIGHT_DELAY_MS = 5.5 * 3600 * 1000;

describe("NotificationSenderService", () => {
  let service: NotificationSenderService;
  const queue = { getJob: jest.fn(), add: jest.fn() };
  const users = { getSettings: jest.fn() };
  const index = { add: jest.fn() };
  const key = buildIdempotencyKey(["WELCOME_ANAMNESIS", "assessment-1"]);
  const request: EnqueueNotificationRequest = {
    userId: "user-1",
    clientId: "client-1",
    recipientPhone: "+5511999998888",
    templateType: "WELCOME_ANAMNESIS",
    params: { name: "Carlos", link: "https://app/#/anamnesis?token=abc" },
    idempotencyKey: key,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(DAYTIME);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    queue.getJob.mockResolvedValue(undefined);
    queue.add.mockResolvedValue({ id: key });
    users.getSettings.mockResolvedValue({ dnd: DEFAULT_DND });
    index.add.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationSenderService,
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: queue },
        { provide: USER_DIRECTORY, useValue: users },
        { provide: PendingJobIndex, useValue: index },
      ],
    }).compile();
    service = moduleRef.get(NotificationSenderService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("adds a self-contained send job keyed by the idempotency key", async () => {
    const result = await service.enqueue(request);

    expect(result).toEqual({
      jobId: key,
      status: "ENQUEUED",
      scheduledDelayMs: 0,
    });
    expect(index.add).toHaveBeenCalledWith("user-1", key, DAYTIME.getTime());
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "send",
      {
        version: 1,
        idempotencyKey: key,
        userId: "user-1",
        clientId: "client-1",
        recipientPhone: "+5511999998888",
        channel: "WHATSAPP",
        templateType: "WELCOME_ANAMNESIS",
        params: { name: "Carlos", link: "https://app/#/anamnesis?token=abc" },
        requestedAt: DAYTIME.toISOString(),
      },
      {
        jobId: key,
        delay: 0,
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    );
  });

  it("delays the job until the end of the do-not-disturb window", async () => {
    jest.setSystemTime(NIGHT);

    const result = await service.enqueue(request);

    expect(users.getSettings).toHaveBeenCalledWith("user-1");
    expect(result.scheduledDelayMs).toBe(NIGHT_DELAY_MS);
    expect(queue.add.mock.calls[0][2]).toMatchObject({ delay: NIGHT_DELAY_MS });
  });

  it("does not delay when the trainer disabled do-not-disturb", async () => {
    jest.setSystemTime(NIGHT);
    users.getSettings.mockResolvedValue({
      dnd: { ...DEFAULT_DND, enabled: false },
    });

    const result = await service.enqueue(request);

    expect(result.scheduledDelayMs).toBe(0);
  });

  it("bypassDnd sends now, without reading the settings", async () => {
    jest.setSystemTime(NIGHT);

    const result = await service.enqueue({ ...request, bypassDnd: true });

    expect(result).toMatchObject({ status: "ENQUEUED", scheduledDelayMs: 0 });
    expect(users.getSettings).not.toHaveBeenCalled();
    expect(queue.add.mock.calls[0][2]).toMatchObject({ delay: 0 });
  });

  it("returns DUPLICATE and adds nothing when the key is already queued", async () => {
    queue.getJob.mockResolvedValue({
      id: key,
      timestamp: DAYTIME.getTime() - 60_000,
      delay: 100_000,
    });

    const result = await service.enqueue(request);

    expect(queue.getJob).toHaveBeenCalledWith(key);
    expect(queue.add).not.toHaveBeenCalled();
    expect(index.add).not.toHaveBeenCalled();
    expect(result).toEqual({
      jobId: key,
      status: "DUPLICATE",
      scheduledDelayMs: 40_000,
    });
  });

  it("reports 0 delay for a duplicate that is already due", async () => {
    queue.getJob.mockResolvedValue({
      id: key,
      timestamp: DAYTIME.getTime() - 60_000,
      delay: 0,
    });

    await expect(service.enqueue(request)).resolves.toMatchObject({
      status: "DUPLICATE",
      scheduledDelayMs: 0,
    });
  });

  it("answers 503 and logs when Redis rejects the add", async () => {
    queue.add.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:6379"));

    await expect(service.enqueue(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED"),
      expect.any(String),
    );
  });

  it("answers 503 when Redis does not answer in time", async () => {
    queue.getJob.mockReturnValue(new Promise(() => undefined));

    const pending = service.enqueue(request);
    const assertion = expect(pending).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await jest.advanceTimersByTimeAsync(QUEUE_CALL_TIMEOUT_MS);

    await assertion;
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("propagates an unknown user from the directory", async () => {
    users.getSettings.mockRejectedValue(
      new NotFoundException("User not found"),
    );

    await expect(service.enqueue(request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});
