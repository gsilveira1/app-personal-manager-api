import {
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  CLIENT_DIRECTORY,
  NOTIFICATION_SENDER,
  USER_DIRECTORY,
} from "../../../common/ports";
import { buildIdempotencyKey } from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";
import { clientSummary, trainerProfile } from "../testing/fixtures";
import { MagicLinkService } from "./magic-link.service";

describe("MagicLinkService", () => {
  let service: MagicLinkService;
  let env: Record<string, string | undefined>;

  const prisma = { workoutSheet: { findFirst: jest.fn() } };
  const jwt = { sign: jest.fn() };
  const clients = { requireOwned: jest.fn() };
  const users = { getProfile: jest.fn() };
  const notifications = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    env = {};
    jwt.sign.mockReturnValue("student-jwt-123");
    clients.requireOwned.mockResolvedValue(clientSummary());
    users.getProfile.mockResolvedValue(
      trainerProfile({
        primaryColor: "#FF0066",
        logoUrl: "https://cdn/logo.png",
      }),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MagicLinkService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
        { provide: CLIENT_DIRECTORY, useValue: clients },
        { provide: USER_DIRECTORY, useValue: users },
        { provide: NOTIFICATION_SENDER, useValue: notifications },
      ],
    }).compile();
    service = module.get(MagicLinkService);
  });

  describe("generate", () => {
    it("signs a 30-day WORKOUT token for the portal audience, carrying the trainer's slug and theme", async () => {
      const result = await service.generate("user-1", "client-1");

      expect(clients.requireOwned).toHaveBeenCalledWith("user-1", "client-1");
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          sub: "client-1",
          clientId: "client-1",
          userId: "user-1",
          slug: "viviana",
          theme: { primaryColor: "#FF0066", logoUrl: "https://cdn/logo.png" },
          action: "WORKOUT",
        },
        { expiresIn: "30d", audience: "vivi:portal" },
      );
      expect(result).toEqual({
        token: "student-jwt-123",
        url: "http://localhost:5173/#/p/viviana?token=student-jwt-123",
      });
    });

    it("builds the URL from FRONTEND_URL, without a trailing slash", async () => {
      env.FRONTEND_URL = "https://app.vivi.com/";
      env.APP_CLIENT_URL = "https://ignored.example";

      const { url } = await service.generate("user-1", "client-1");

      expect(url).toBe(
        "https://app.vivi.com/#/p/viviana?token=student-jwt-123",
      );
    });

    it("falls back to APP_CLIENT_URL", async () => {
      env.APP_CLIENT_URL = "https://client.vivi.com";

      const { url } = await service.generate("user-1", "client-1");

      expect(url).toBe(
        "https://client.vivi.com/#/p/viviana?token=student-jwt-123",
      );
    });

    it("does not sign anything for another trainer's client", async () => {
      clients.requireOwned.mockRejectedValue(new ForbiddenException());

      await expect(service.generate("user-1", "client-9")).rejects.toThrow(
        ForbiddenException,
      );
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });

  describe("send", () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-03T14:05:42.123Z"));
      notifications.enqueue.mockResolvedValue({
        jobId: "job-1",
        status: "ENQUEUED",
        scheduledDelayMs: 0,
      });
    });
    afterEach(() => jest.useRealTimers());

    it("enqueues WORKOUT_LINK with a key of client, active sheet and UTC minute", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue({ id: "sheet-1" });
      const link = "http://localhost:5173/#/p/viviana?token=student-jwt-123";

      const result = await service.send("user-1", "client-1");

      expect(prisma.workoutSheet.findFirst).toHaveBeenCalledWith({
        where: { clientId: "client-1", active: true, isTemplate: false },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      expect(notifications.enqueue).toHaveBeenCalledTimes(1);
      expect(notifications.enqueue).toHaveBeenCalledWith({
        userId: "user-1",
        clientId: "client-1",
        recipientPhone: "+5511999998888",
        templateType: "WORKOUT_LINK",
        params: { name: "Mariana", link },
        idempotencyKey: buildIdempotencyKey([
          "WORKOUT_LINK",
          "client-1",
          "sheet-1",
          "2026-10-03T14:05",
        ]),
      });
      expect(result).toEqual({
        status: "QUEUED",
        channel: "WHATSAPP",
        jobId: "job-1",
        scheduledDelayMs: 0,
        link,
        message: "Disparo adicionado à fila com sucesso.",
      });
    });

    it('uses "none" in the key when the client has no active sheet', async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(null);

      await service.send("user-1", "client-1");

      expect(notifications.enqueue.mock.calls[0][0].idempotencyKey).toBe(
        buildIdempotencyKey([
          "WORKOUT_LINK",
          "client-1",
          "none",
          "2026-10-03T14:05",
        ]),
      );
    });

    it("a duplicate within the minute reports QUEUED with the existing job and its delay", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue({ id: "sheet-1" });
      notifications.enqueue.mockResolvedValue({
        jobId: "job-1",
        status: "DUPLICATE",
        scheduledDelayMs: 7_200_000,
      });

      const result = await service.send("user-1", "client-1");

      expect(result).toMatchObject({
        status: "QUEUED",
        jobId: "job-1",
        scheduledDelayMs: 7_200_000,
      });
    });

    it("propagates 503 when the queue is down", async () => {
      prisma.workoutSheet.findFirst.mockResolvedValue(null);
      notifications.enqueue.mockRejectedValue(
        new ServiceUnavailableException(),
      );

      await expect(service.send("user-1", "client-1")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
