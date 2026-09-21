import { Test, TestingModule } from "@nestjs/testing";
import { MessagingService } from "./messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import { AnamnesisService } from "../anamnesis/anamnesis.service";
import { StudentPortalService } from "../student-portal/student-portal.service";

describe("MessagingService", () => {
  let service: MessagingService;
  let _prisma: PrismaService;
  let _anamnesisService: AnamnesisService;
  let _studentPortalService: StudentPortalService;

  const mockPrismaService: any = {
    client: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    notificationLog: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };


  const mockAnamnesisService = {
    generateMagicLinkToken: jest.fn().mockResolvedValue({
      token: "anam-tok",
      link: "/anamnesis?token=anam-tok",
    }),
  };

  const mockStudentPortalService = {
    generateWorkoutMagicLink: jest
      .fn()
      .mockResolvedValue("/student-portal?token=student-tok"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AnamnesisService, useValue: mockAnamnesisService },
        { provide: StudentPortalService, useValue: mockStudentPortalService },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);
    _prisma = module.get<PrismaService>(PrismaService);
    _anamnesisService = module.get<AnamnesisService>(AnamnesisService);
    _studentPortalService =
      module.get<StudentPortalService>(StudentPortalService);
    jest.clearAllMocks();
  });

  describe("calculateDndDelayMs", () => {
    it("should return 0 delay during daytime in America/Sao_Paulo (e.g. 14:00 BRT)", () => {
      // 14:00 BRT is 17:00 UTC (UTC-3)
      const dayTimeUtc = new Date("2026-09-20T17:00:00.000Z");
      const delay = service.calculateDndDelayMs(dayTimeUtc);
      expect(delay).toBe(0);
    });

    it("should return delay until 08:00 AM during night in America/Sao_Paulo (e.g. 02:30 BRT)", () => {
      // 02:30 BRT is 05:30 UTC
      const nightTimeUtc = new Date("2026-09-20T05:30:00.000Z");
      const delay = service.calculateDndDelayMs(nightTimeUtc);
      expect(delay).toBeGreaterThan(0);
      // 5.5 hours = 5.5 * 3600 * 1000 = 19,800,000 ms
      expect(delay).toBe(5.5 * 3600 * 1000);
    });
  });

  describe("resendLink", () => {
    it("should resend anamnesis link and handle disconnected WhatsApp with email fallback", async () => {
      mockPrismaService.client.findUnique.mockResolvedValue({
        id: "client-1",
        userId: "user-1",
        phone: "+5511999998888",
        user: {
          tenantId: "tenant-1",
          tenant: { whatsappStatus: "DISCONNECTED" },
        },
      });
      mockPrismaService.notificationLog.create.mockResolvedValue({
        id: "log-1",
      });

      const result = await service.resendLink(
        "user-1",
        "client-1",
        "ANAMNESIS",
      );

      expect(result.status).toBe("QUEUED");
      expect(result.channel).toBe("EMAIL");
      expect(mockPrismaService.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: "EMAIL",
            templateType: "WELCOME_ANAMNESIS",
          }),
        }),
      );
    });
  });

  describe("getTenantQueue", () => {
    it("should return empty queue if user has no tenant", async () => {
      mockPrismaService.user = { findUnique: jest.fn().mockResolvedValue({ tenantId: null }) };
      const result = await service.getTenantQueue("user-no-tenant", {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.summary.totalQueued).toBe(0);
    });

    it("should return paginated logs and aggregate summary counts", async () => {
      mockPrismaService.user = { findUnique: jest.fn().mockResolvedValue({ tenantId: "tenant-1" }) };
      mockPrismaService.notificationLog.count = jest
        .fn()
        .mockResolvedValueOnce(10) // total matching
        .mockResolvedValueOnce(3) // queued
        .mockResolvedValueOnce(5) // sent
        .mockResolvedValueOnce(2) // failed
        .mockResolvedValueOnce(0); // cancelled
      mockPrismaService.notificationLog.findMany = jest.fn().mockResolvedValue([
        { id: "log-1", templateType: "WELCOME_ANAMNESIS", status: "QUEUED", recipientPhone: "11999999999" },
      ]);

      const result = await service.getTenantQueue("user-1", { status: "QUEUED", page: 1, limit: 10 });
      expect(result.total).toBe(10);
      expect(result.items.length).toBe(1);
      expect(result.summary).toEqual({
        totalQueued: 3,
        totalSent: 5,
        totalFailed: 2,
        totalCancelled: 0,
      });
    });
  });

  describe("getClientMessageHistory", () => {
    it("should throw ForbiddenException if client does not belong to user", async () => {
      mockPrismaService.client.findUnique.mockResolvedValue({
        id: "client-1",
        userId: "other-user",
        phone: "11999999999",
      });

      await expect(service.getClientMessageHistory("user-1", "client-1")).rejects.toThrow();
    });

    it("should return notification logs for matching client phone and tenant", async () => {
      mockPrismaService.client.findUnique.mockResolvedValue({
        id: "client-1",
        userId: "user-1",
        phone: "11999999999",
        tenantId: "tenant-1",
      });
      mockPrismaService.notificationLog.findMany = jest.fn().mockResolvedValue([
        { id: "log-1", recipientPhone: "11999999999", status: "SENT", templateType: "WORKOUT_LINK" },
      ]);

      const result = await service.getClientMessageHistory("user-1", "client-1");
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("SENT");
    });
  });

  describe("retryNotification", () => {
    it("should update log to SENT via WhatsApp when WhatsApp is CONNECTED", async () => {
      mockPrismaService.user = {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: "tenant-1",
          tenant: { whatsappStatus: "CONNECTED" },
        }),
      };
      mockPrismaService.notificationLog.findUnique = jest.fn().mockResolvedValue({
        id: "log-failed",
        tenantId: "tenant-1",
        status: "FAILED",
      });
      mockPrismaService.notificationLog.update = jest.fn().mockResolvedValue({
        id: "log-failed",
        status: "SENT",
        channel: "WHATSAPP",
      });

      const result = await service.retryNotification("user-1", "log-failed");
      expect(result.message).toBe("Mensagem reenviada com sucesso.");
      expect(result.notification.status).toBe("SENT");
    });
  });

  describe("cancelNotification", () => {
    it("should mark queued notification as CANCELLED", async () => {
      mockPrismaService.user = {
        findUnique: jest.fn().mockResolvedValue({ tenantId: "tenant-1" }),
      };
      mockPrismaService.notificationLog.findUnique = jest.fn().mockResolvedValue({
        id: "log-queued",
        tenantId: "tenant-1",
        status: "QUEUED",
      });
      mockPrismaService.notificationLog.update = jest.fn().mockResolvedValue({
        id: "log-queued",
        status: "CANCELLED",
      });

      const result = await service.cancelNotification("user-1", "log-queued");
      expect(result.message).toBe("Mensagem cancelada com sucesso.");
      expect(result.notification.status).toBe("CANCELLED");
    });
  });
});

