import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { AssessmentType } from "@prisma/client";
import {
  AnamnesisService,
  INVALID_LINK_MESSAGE,
  perimetersFrom,
  TOKEN_TTL_MS,
} from "./anamnesis.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ANAMNESIS_REQUESTER,
  CLIENT_DIRECTORY,
  NOTIFICATION_SENDER,
  USER_DIRECTORY,
} from "../../common/ports";
import { buildIdempotencyKey } from "../../common/types";

describe("AnamnesisService", () => {
  let service: AnamnesisService;
  let prisma: any;
  let clients: { requireOwned: jest.Mock; findById: jest.Mock };
  let users: { getProfile: jest.Mock };
  let notifications: { enqueue: jest.Mock };

  const NOW = new Date("2026-10-03T12:00:00Z");
  const userId = "user-1";
  const clientId = "client-1";
  const client = {
    id: clientId,
    userId,
    name: "Mariana Souza",
    phone: "5553999990000",
  };
  const pendingRow = {
    id: "anam-1",
    type: AssessmentType.ANAMNESIS,
    data: { version: 1 },
    date: new Date("2026-10-01T00:00:00Z"),
    magicToken: "valid-token",
    tokenExpiresAt: new Date("2026-10-08T00:00:00Z"),
    clientId,
    userId,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  };
  // Only the clock is faked; timers and ticks stay real so async code runs normally.
  const DO_NOT_FAKE = [
    "nextTick",
    "setImmediate",
    "clearImmediate",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "queueMicrotask",
  ] as const;
  const ENV_KEYS = ["FRONTEND_URL", "APP_CLIENT_URL"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...DO_NOT_FAKE] });
    ENV_KEYS.forEach((key) => (savedEnv[key] = process.env[key]));
    process.env.FRONTEND_URL = "https://app.vivi.test/";
    delete process.env.APP_CLIENT_URL;

    prisma = {
      assessment: {
        create: jest.fn().mockResolvedValue({ id: "anam-1" }),
        findUnique: jest.fn().mockResolvedValue(pendingRow),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((run: (tx: unknown) => unknown) => run(prisma)),
    };
    clients = {
      requireOwned: jest.fn().mockResolvedValue(client),
      findById: jest.fn().mockResolvedValue(client),
    };
    users = {
      getProfile: jest.fn().mockResolvedValue({
        id: userId,
        name: "Viviana Personal",
        primaryColor: "#10B981",
        logoUrl: "https://logo.png",
      }),
    };
    notifications = {
      enqueue: jest.fn().mockResolvedValue({
        jobId: "job-1",
        status: "ENQUEUED",
        scheduledDelayMs: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnamnesisService,
        { provide: ANAMNESIS_REQUESTER, useExisting: AnamnesisService },
        { provide: PrismaService, useValue: prisma },
        { provide: CLIENT_DIRECTORY, useValue: clients },
        { provide: USER_DIRECTORY, useValue: users },
        { provide: NOTIFICATION_SENDER, useValue: notifications },
      ],
    }).compile();

    service = module.get(AnamnesisService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    ENV_KEYS.forEach((key) => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
  });

  describe("requestAnamnesis (magic link)", () => {
    it("should create a pending ANAMNESIS with an opaque token valid for 7 days", async () => {
      const result = await service.requestAnamnesis(userId, clientId, {
        notify: false,
      });

      expect(clients.requireOwned).toHaveBeenCalledWith(userId, clientId);
      expect(result.token).toMatch(/^[a-f0-9]{64}$/);
      expect(prisma.assessment.create).toHaveBeenCalledWith({
        data: {
          type: AssessmentType.ANAMNESIS,
          data: { version: 1 },
          magicToken: result.token,
          tokenExpiresAt: new Date(NOW.getTime() + TOKEN_TTL_MS),
          clientId,
          userId,
        },
      });
      expect(TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(result).toEqual({
        assessmentId: "anam-1",
        token: result.token,
        link: `https://app.vivi.test/anamnesis?token=${result.token}`,
        notification: null,
      });
      expect(notifications.enqueue).not.toHaveBeenCalled();
    });

    it("should issue a different token on every request", async () => {
      const first = await service.createMagicLink(userId, clientId);
      const second = await service.createMagicLink(userId, clientId);
      expect(first.token).not.toBe(second.token);
    });

    it("should fall back to APP_CLIENT_URL and then to localhost for the link", async () => {
      delete process.env.FRONTEND_URL;
      process.env.APP_CLIENT_URL = "https://client.vivi.test";
      const second = await service.createMagicLink(userId, clientId);
      expect(second.link).toBe(
        `https://client.vivi.test/anamnesis?token=${second.token}`,
      );

      delete process.env.APP_CLIENT_URL;
      const third = await service.createMagicLink(userId, clientId);
      expect(third.link).toBe(
        `http://localhost:5173/anamnesis?token=${third.token}`,
      );
    });

    it("should return only token and link from createMagicLink", async () => {
      const result = await service.createMagicLink(userId, clientId);
      expect(Object.keys(result).sort()).toEqual(["link", "token"]);
      expect(notifications.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ["missing or soft-deleted", new NotFoundException(), NotFoundException],
      ["of another trainer", new ForbiddenException(), ForbiddenException],
    ])(
      "should create nothing when the client is %s",
      async (_label, error, expected) => {
        clients.requireOwned.mockRejectedValue(error);

        await expect(
          service.requestAnamnesis(userId, clientId, { notify: true }),
        ).rejects.toThrow(expected);
        expect(prisma.assessment.create).not.toHaveBeenCalled();
        expect(notifications.enqueue).not.toHaveBeenCalled();
      },
    );

    it("should be the implementation behind the ANAMNESIS_REQUESTER token", async () => {
      const module = await Test.createTestingModule({
        providers: [
          AnamnesisService,
          { provide: ANAMNESIS_REQUESTER, useExisting: AnamnesisService },
          { provide: PrismaService, useValue: prisma },
          { provide: CLIENT_DIRECTORY, useValue: clients },
          { provide: USER_DIRECTORY, useValue: users },
          { provide: NOTIFICATION_SENDER, useValue: notifications },
        ],
      }).compile();
      expect(module.get(ANAMNESIS_REQUESTER)).toBe(
        module.get(AnamnesisService),
      );
    });
  });

  describe("requestReassessment", () => {
    it("should enqueue WELCOME_ANAMNESIS with the assessment-based idempotency key", async () => {
      const result = await service.requestReassessment(userId, clientId);

      expect(notifications.enqueue).toHaveBeenCalledTimes(1);
      expect(notifications.enqueue).toHaveBeenCalledWith({
        userId,
        clientId,
        recipientPhone: "5553999990000",
        templateType: "WELCOME_ANAMNESIS",
        params: { name: "Mariana Souza", link: result.link },
        idempotencyKey: buildIdempotencyKey(["WELCOME_ANAMNESIS", "anam-1"]),
      });
      expect(result).toEqual({
        message: expect.stringContaining("sucesso"),
        token: expect.stringMatching(/^[a-f0-9]{64}$/),
        link: expect.stringContaining("/anamnesis?token="),
        notification: { status: "QUEUED", jobId: "job-1", scheduledDelayMs: 0 },
      });
    });

    it("should report the do-not-disturb delay returned by the queue", async () => {
      notifications.enqueue.mockResolvedValue({
        jobId: "job-2",
        status: "ENQUEUED",
        scheduledDelayMs: 3_600_000,
      });

      const result = await service.requestReassessment(userId, clientId);
      expect(result.notification.scheduledDelayMs).toBe(3_600_000);
    });

    it("should propagate 503 and log when the queue is down (never swallowed)", async () => {
      const logged = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      notifications.enqueue.mockRejectedValue(
        new ServiceUnavailableException("Redis down"),
      );

      await expect(
        service.requestReassessment(userId, clientId),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.assessment.create).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("assessmentId=anam-1"),
        expect.any(String),
      );
    });
  });

  describe("getFormMetadata", () => {
    it("should get form metadata for valid token, with branding from the user directory", async () => {
      const result = await service.getFormMetadata("valid-token");

      expect(prisma.assessment.findUnique).toHaveBeenCalledWith({
        where: { magicToken: "valid-token" },
      });
      expect(clients.findById).toHaveBeenCalledWith(clientId);
      expect(users.getProfile).toHaveBeenCalledWith(userId);
      expect(result).toEqual({
        studentName: "Mariana Souza",
        personalName: "Viviana Personal",
        theme: { primaryColor: "#10B981", logoUrl: "https://logo.png" },
      });
    });

    it("should answer 401 for an unknown or already used token", async () => {
      prisma.assessment.findUnique.mockResolvedValue(null);

      await expect(service.getFormMetadata("used-token")).rejects.toThrow(
        new UnauthorizedException(INVALID_LINK_MESSAGE),
      );
    });

    it("should answer 401 for an expired token", async () => {
      prisma.assessment.findUnique.mockResolvedValue({
        ...pendingRow,
        tokenExpiresAt: new Date(NOW.getTime() - 1),
      });

      await expect(service.getFormMetadata("valid-token")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(clients.findById).not.toHaveBeenCalled();
    });

    it.each([undefined, ""])(
      "should answer 401 without querying when the token is %p",
      async (token) => {
        await expect(service.getFormMetadata(token)).rejects.toThrow(
          UnauthorizedException,
        );
        expect(prisma.assessment.findUnique).not.toHaveBeenCalled();
      },
    );

    it("should answer 404 when the client is missing or soft-deleted", async () => {
      clients.findById.mockResolvedValue(null);

      await expect(service.getFormMetadata("valid-token")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("submit", () => {
    const createdEvaluations = () =>
      prisma.assessment.create.mock.calls.map(([args]: [any]) => args.data);

    it("should store the answers, clear the token and lock the row in one transaction", async () => {
      const result = await service.submit({
        token: "valid-token",
        medicalHistory: "none",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.assessment.updateMany).toHaveBeenCalledWith({
        where: { id: "anam-1", magicToken: "valid-token" },
        data: {
          data: { version: 1, medicalHistory: "none" },
          date: NOW,
          magicToken: null,
          tokenExpiresAt: null,
        },
      });
      expect(result).toEqual({
        message: expect.stringContaining("sucesso"),
        id: "anam-1",
      });
    });

    it("should not create an evaluation when weightKg is absent (no invented weight)", async () => {
      await service.submit({
        token: "valid-token",
        measurements: { waist: 80 },
      });

      expect(prisma.assessment.create).not.toHaveBeenCalled();
    });

    it("should create a PHYSICAL_EVALUATION when weightKg is present, keeping only perimeter keys", async () => {
      await service.submit({
        token: "valid-token",
        weightKg: 65,
        measurements: { waist: 80, hip: 95, neck: 35 },
      });

      expect(createdEvaluations()).toEqual([
        {
          type: AssessmentType.PHYSICAL_EVALUATION,
          data: {
            version: 1,
            weight: 65,
            perimeters: { waist: 80, hip: 95 },
            notes: "Anamnese inicial preenchida pelo aluno",
          },
          date: NOW,
          clientId,
          userId,
        },
      ]);
    });

    it("should omit perimeters when no measurement is a perimeter", async () => {
      await service.submit({ token: "valid-token", weightKg: 65 });

      expect(createdEvaluations()[0].data).toEqual({
        version: 1,
        weight: 65,
        notes: "Anamnese inicial preenchida pelo aluno",
      });
    });

    it("should reject submission if token is already used", async () => {
      prisma.assessment.findUnique.mockResolvedValue(null);

      await expect(
        service.submit({ token: "used-token", medicalHistory: "none" }),
      ).rejects.toThrow(new UnauthorizedException(INVALID_LINK_MESSAGE));
      expect(prisma.assessment.updateMany).not.toHaveBeenCalled();
    });

    it("should reject an expired token", async () => {
      prisma.assessment.findUnique.mockResolvedValue({
        ...pendingRow,
        tokenExpiresAt: NOW,
      });

      await expect(service.submit({ token: "valid-token" })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.assessment.updateMany).not.toHaveBeenCalled();
    });

    it("should answer 401 and create no evaluation when the claim loses the race (updateMany count 0)", async () => {
      prisma.assessment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.submit({ token: "valid-token", weightKg: 65 }),
      ).rejects.toThrow(new UnauthorizedException(INVALID_LINK_MESSAGE));
      expect(prisma.assessment.create).not.toHaveBeenCalled();
    });

    it("should let exactly one of two concurrent submissions with the same token succeed", async () => {
      // Both requests read the row while the token is still set; the database then
      // lets only the first conditional update match.
      prisma.assessment.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const outcomes = await Promise.allSettled([
        service.submit({ token: "valid-token", weightKg: 65 }),
        service.submit({ token: "valid-token", weightKg: 99 }),
      ]);

      expect(outcomes.map((o) => o.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const rejected = outcomes.find(
        (o): o is PromiseRejectedResult => o.status === "rejected",
      );
      expect(rejected?.reason).toBeInstanceOf(UnauthorizedException);
      expect(prisma.assessment.create).toHaveBeenCalledTimes(1);
    });

    it("should answer 404 when the client was soft-deleted, leaving the token untouched", async () => {
      clients.findById.mockResolvedValue(null);

      await expect(service.submit({ token: "valid-token" })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("should answer 400 on invalid answers without consuming the token", async () => {
      await expect(
        service.submit({
          token: "valid-token",
          parqAnswers: { q1: "yes" } as any,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("should propagate a database failure (no silent failure)", async () => {
      prisma.assessment.updateMany.mockRejectedValue(new Error("db down"));

      await expect(service.submit({ token: "valid-token" })).rejects.toThrow(
        "db down",
      );
    });
  });

  describe("listForClient", () => {
    it("should list the client's anamneses newest first, without tokens", async () => {
      prisma.assessment.findMany.mockResolvedValue([
        pendingRow,
        {
          ...pendingRow,
          id: "anam-0",
          magicToken: null,
          tokenExpiresAt: null,
          data: { version: 1, fitnessGoals: "Hipertrofia" },
          date: new Date("2026-09-01T00:00:00Z"),
        },
      ]);

      const result = await service.listForClient(userId, clientId);

      expect(clients.requireOwned).toHaveBeenCalledWith(userId, clientId);
      expect(prisma.assessment.findMany).toHaveBeenCalledWith({
        where: { clientId, userId, type: AssessmentType.ANAMNESIS },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((v) => [v.id, v.status, v.isCurrent])).toEqual([
        ["anam-1", "PENDING", false],
        ["anam-0", "SUBMITTED", true],
      ]);
      expect(result[1].fitnessGoals).toBe("Hipertrofia");
      expect(JSON.stringify(result)).not.toContain("valid-token");
    });

    it("should answer 403 for a client of another trainer", async () => {
      clients.requireOwned.mockRejectedValue(new ForbiddenException());

      await expect(service.listForClient(userId, clientId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.assessment.findMany).not.toHaveBeenCalled();
    });
  });

  describe("perimetersFrom", () => {
    it("keeps only PerimetersDto keys", () => {
      expect(perimetersFrom({ waist: 80, neck: 35, calf: 36 })).toEqual({
        waist: 80,
        calf: 36,
      });
    });

    it("returns undefined when nothing remains", () => {
      expect(perimetersFrom({ neck: 35 })).toBeUndefined();
      expect(perimetersFrom(undefined)).toBeUndefined();
    });
  });
});
