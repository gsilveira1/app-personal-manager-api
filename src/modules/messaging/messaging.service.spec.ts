import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import { AnamnesisService } from "../anamnesis/anamnesis.service";
import { StudentPortalService } from "../student-portal/student-portal.service";
import { WhatsAppService } from "./whatsapp.service";

describe("MessagingService", () => {
  let service: MessagingService;
  let _prisma: PrismaService;
  let _anamnesisService: AnamnesisService;
  let _studentPortalService: StudentPortalService;
  let _whatsappService: WhatsAppService;

  const mockPrismaService: any = {
    client: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    notificationLog: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockWhatsAppService = {
    cleanPhoneNumber: jest.fn((phone: string) => phone.replace(/\D/g, "")),
    sendTextMessage: jest
      .fn()
      .mockResolvedValue({ success: true, messageId: "msg-123" }),
    checkInstanceStatus: jest.fn().mockResolvedValue({ status: "CONNECTED" }),
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
      .mockResolvedValue({ url: "/student-portal?token=student-tok" }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AnamnesisService, useValue: mockAnamnesisService },
        { provide: StudentPortalService, useValue: mockStudentPortalService },
        { provide: WhatsAppService, useValue: mockWhatsAppService },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);
    _prisma = module.get<PrismaService>(PrismaService);
    _anamnesisService = module.get<AnamnesisService>(AnamnesisService);
    _studentPortalService =
      module.get<StudentPortalService>(StudentPortalService);
    _whatsappService = module.get<WhatsAppService>(WhatsAppService);
    jest.clearAllMocks();

    mockPrismaService.tenant.findUnique.mockResolvedValue({
      id: "tenant-1",
      whatsappStatus: "CONNECTED",
      whatsappInstanceName: "tenant-vivi-001",
      features: { dndEnabled: true, dndStartHour: 22, dndEndHour: 8 },
    });
    mockPrismaService.tenant.update.mockResolvedValue({
      id: "tenant-1",
      whatsappStatus: "CONNECTED",
    });
  });

  describe("getTenantDndConfig", () => {
    it("should return default DND config when tenantId is null or missing", async () => {
      const config = await service.getTenantDndConfig(null);
      expect(config).toEqual({
        enabled: true,
        startHour: 22,
        endHour: 8,
        timezone: "America/Sao_Paulo",
      });
    });

    it("should parse flat DND feature flags from tenant.features", async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        features: {
          dndEnabled: false,
          dndStartHour: 23,
          dndEndHour: 7,
          dndTimezone: "America/Manaus",
        },
      });

      const config = await service.getTenantDndConfig("tenant-flat");
      expect(config).toEqual({
        enabled: false,
        startHour: 23,
        endHour: 7,
        timezone: "America/Manaus",
      });
    });

    it("should parse nested DND feature flags from tenant.features", async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        features: {
          dnd: {
            enabled: false,
            startHour: 20,
            endHour: 6,
            timezone: "America/Cuiaba",
          },
        },
      });

      const config = await service.getTenantDndConfig("tenant-nested");
      expect(config).toEqual({
        enabled: false,
        startHour: 20,
        endHour: 6,
        timezone: "America/Cuiaba",
      });
    });

    it("should fallback to defaults on malformed JSON or Prisma errors", async () => {
      mockPrismaService.tenant.findUnique.mockRejectedValueOnce(
        new Error("DB error"),
      );

      const config = await service.getTenantDndConfig("tenant-err");
      expect(config.enabled).toBe(true);
      expect(config.startHour).toBe(22);
      expect(config.endHour).toBe(8);
    });
  });

  describe("calculateDndDelayMs", () => {
    it("should return 0 delay when DND feature flag is disabled (enabled: false)", () => {
      // 02:30 BRT would normally be in DND
      const nightTimeUtc = new Date("2026-09-20T05:30:00.000Z");
      const delay = service.calculateDndDelayMs(nightTimeUtc, {
        enabled: false,
      });
      expect(delay).toBe(0);
    });

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

    it("should return delay until 08:00 AM next morning when time is 23:00 BRT", () => {
      // 23:00 BRT is 02:00 UTC next day
      const nightTimeUtc = new Date("2026-09-20T02:00:00.000Z");
      const delay = service.calculateDndDelayMs(nightTimeUtc);
      expect(delay).toBeGreaterThan(0);
    });

    it("should respect custom DND startHour and endHour per tenant", () => {
      // 21:00 BRT is 00:00 UTC next day
      const eveningTimeUtc = new Date("2026-09-20T00:00:00.000Z");
      // Default (22-8) is not in DND at 21:00
      expect(service.calculateDndDelayMs(eveningTimeUtc)).toBe(0);
      // Custom (20-6) is in DND at 21:00
      const customDelay = service.calculateDndDelayMs(eveningTimeUtc, {
        enabled: true,
        startHour: 20,
        endHour: 6,
      });
      expect(customDelay).toBeGreaterThan(0);
    });
  });

  describe("formatMessage", () => {
    it("should format WELCOME_ANAMNESIS template correctly", () => {
      const msg = service.formatMessage("WELCOME_ANAMNESIS", {
        name: "Carlos",
        link: "https://viviops.app/anamnesis/123",
      });
      expect(msg).toContain("Carlos");
      expect(msg).toContain("https://viviops.app/anamnesis/123");
      expect(msg).toContain("anamnese");
    });

    it("should format WORKOUT_LINK template correctly", () => {
      const msg = service.formatMessage("WORKOUT_LINK", {
        name: "Mariana",
        link: "https://viviops.app/workouts/456",
      });
      expect(msg).toContain("Mariana");
      expect(msg).toContain("https://viviops.app/workouts/456");
      expect(msg).toContain("ficha de treinos");
    });

    it("should format EXPIRATION_ALERT template correctly", () => {
      const msg = service.formatMessage("EXPIRATION_ALERT", { name: "Lucas" });
      expect(msg).toContain("Lucas");
      expect(msg).toContain("periodização");
    });
  });

  describe("dispatchWhatsAppMessage", () => {
    it("should return failure if tenantId is missing", async () => {
      const result = await service.dispatchWhatsAppMessage(
        null,
        "+5511999998888",
        "Hello",
      );
      expect(result.success).toBe(false);
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("Tenant não configurado");
    });

    it("should send via WhatsApp when tenant is CONNECTED and has instanceName", async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });
      mockWhatsAppService.sendTextMessage.mockResolvedValueOnce({
        success: true,
        messageId: "msg-999",
      });

      const result = await service.dispatchWhatsAppMessage(
        "tenant-1",
        "+5511999998888",
        "Olá, seu treino está pronto!",
      );

      expect(mockWhatsAppService.sendTextMessage).toHaveBeenCalledWith(
        "tenant-vivi-001",
        "+5511999998888",
        "Olá, seu treino está pronto!",
      );
      expect(result.success).toBe(true);
      expect(result.channel).toBe("WHATSAPP");
      expect(result.status).toBe("SENT");
    });

    it("should handle Evolution API HTTP 404 instance not found by updating tenant status to DISCONNECTED and falling back to EMAIL", async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });
      mockWhatsAppService.sendTextMessage.mockResolvedValueOnce({
        success: false,
        error:
          'Evolution API HTTP 404: {"status":404,"error":"Not Found","response":{"message":["The \\"tenant-vivi-001\\" instance does not exist"]}}',
      });
      mockPrismaService.tenant.update = jest.fn().mockResolvedValueOnce({
        id: "tenant-1",
        whatsappStatus: "DISCONNECTED",
      });

      const result = await service.dispatchWhatsAppMessage(
        "tenant-1",
        "+5511999998888",
        "Test message",
      );

      expect(mockPrismaService.tenant.update).toHaveBeenCalledWith({
        where: { id: "tenant-1" },
        data: { whatsappStatus: "DISCONNECTED" },
      });
      expect(result.success).toBe(true);
      expect(result.channel).toBe("EMAIL");
      expect(result.status).toBe("SENT");
      expect(result.error).toContain("Sent via email fallback");
      expect(result.error).toContain("tenant-vivi-001");
    });

    it("should return FAILED status when input validation fails (e.g. invalid phone number) without disconnecting tenant", async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });
      mockWhatsAppService.sendTextMessage.mockResolvedValueOnce({
        success: false,
        error: "Número de telefone inválido: 123",
      });
      mockPrismaService.tenant.update = jest.fn();

      const result = await service.dispatchWhatsAppMessage(
        "tenant-1",
        "123",
        "Test message",
      );

      expect(mockPrismaService.tenant.update).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.channel).toBe("WHATSAPP");
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("Número de telefone inválido");
    });

    it("should fallback to EMAIL when tenant WhatsApp is DISCONNECTED", async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "DISCONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });

      const result = await service.dispatchWhatsAppMessage(
        "tenant-1",
        "+5511999998888",
        "Test message",
      );

      expect(mockWhatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(result.channel).toBe("EMAIL");
      expect(result.status).toBe("SENT");
      expect(result.error).toContain("email fallback");
    });
  });

  describe("resendLink", () => {
    it("should throw ForbiddenException if client does not belong to user", async () => {
      mockPrismaService.client.findUnique.mockResolvedValueOnce({
        id: "client-1",
        userId: "other-user",
      });

      await expect(
        service.resendLink("user-1", "client-1", "ANAMNESIS"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should immediately send WhatsApp message when outside DND and WhatsApp is CONNECTED", async () => {
      jest.spyOn(service, "calculateDndDelayMs").mockReturnValue(0);

      mockPrismaService.client.findUnique.mockResolvedValueOnce({
        id: "client-1",
        name: "Carlos",
        userId: "user-1",
        phone: "+5511999998888",
        user: {
          tenantId: "tenant-1",
          tenant: {
            whatsappStatus: "CONNECTED",
            whatsappInstanceName: "tenant-vivi-001",
          },
        },
      });

      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });

      mockWhatsAppService.sendTextMessage.mockResolvedValueOnce({
        success: true,
        messageId: "msg-123",
      });

      mockPrismaService.notificationLog.create.mockResolvedValueOnce({
        id: "log-1",
      });

      const result = await service.resendLink(
        "user-1",
        "client-1",
        "WORKOUT_SHEET",
      );

      expect(mockWhatsAppService.sendTextMessage).toHaveBeenCalled();
      expect(result.status).toBe("SENT");
      expect(result.channel).toBe("WHATSAPP");
      expect(mockPrismaService.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "SENT",
            channel: "WHATSAPP",
          }),
        }),
      );
    });

    it("should enqueue message when inside DND window", async () => {
      jest.spyOn(service, "calculateDndDelayMs").mockReturnValue(18000000); // 5 hours delay

      mockPrismaService.client.findUnique.mockResolvedValueOnce({
        id: "client-1",
        name: "Carlos",
        userId: "user-1",
        phone: "+5511999998888",
        user: {
          tenantId: "tenant-1",
          tenant: {
            whatsappStatus: "CONNECTED",
            whatsappInstanceName: "tenant-vivi-001",
          },
        },
      });

      mockPrismaService.notificationLog.create.mockResolvedValueOnce({
        id: "log-dnd",
      });

      const result = await service.resendLink(
        "user-1",
        "client-1",
        "ANAMNESIS",
      );

      expect(mockWhatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(result.status).toBe("QUEUED");
      expect(result.channel).toBe("WHATSAPP");
      expect(result.scheduledDelayMs).toBe(18000000);
      expect(mockPrismaService.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "QUEUED",
            channel: "WHATSAPP",
          }),
        }),
      );
    });

    it("should handle disconnected WhatsApp with email fallback when resending link", async () => {
      jest.spyOn(service, "calculateDndDelayMs").mockReturnValue(0);

      mockPrismaService.client.findUnique.mockResolvedValueOnce({
        id: "client-1",
        name: "Carlos",
        userId: "user-1",
        phone: "+5511999998888",
        user: {
          tenantId: "tenant-1",
          tenant: { whatsappStatus: "DISCONNECTED" },
        },
      });

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        whatsappStatus: "DISCONNECTED",
      });

      mockPrismaService.notificationLog.create.mockResolvedValueOnce({
        id: "log-1",
      });

      const result = await service.resendLink(
        "user-1",
        "client-1",
        "ANAMNESIS",
      );

      expect(result.status).toBe("SENT");
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

  describe("enqueueNotification", () => {
    it("should immediately dispatch notification if outside DND", async () => {
      jest.spyOn(service, "calculateDndDelayMs").mockReturnValue(0);

      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });
      mockWhatsAppService.sendTextMessage.mockResolvedValueOnce({
        success: true,
        messageId: "msg-welcome",
      });
      mockPrismaService.notificationLog.create.mockResolvedValueOnce({
        id: "log-welcome",
      });

      const result = await service.enqueueNotification({
        tenantId: "tenant-1",
        recipientPhone: "+5511988887777",
        templateType: "WELCOME_ANAMNESIS",
        clientName: "Fernanda",
        link: "https://viviops.app/anamnesis/f123",
      });

      expect(result.status).toBe("SENT");
      expect(result.channel).toBe("WHATSAPP");
      expect(mockWhatsAppService.sendTextMessage).toHaveBeenCalledWith(
        "tenant-vivi-001",
        "+5511988887777",
        expect.stringContaining("Fernanda"),
      );
    });

    it("should record QUEUED status if inside DND", async () => {
      jest.spyOn(service, "calculateDndDelayMs").mockReturnValue(12000000);
      mockPrismaService.notificationLog.create.mockResolvedValueOnce({
        id: "log-queued",
      });

      const result = await service.enqueueNotification({
        tenantId: "tenant-1",
        recipientPhone: "+5511988887777",
        templateType: "WELCOME_ANAMNESIS",
        clientName: "Fernanda",
      });

      expect(result.status).toBe("QUEUED");
      expect(mockWhatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(mockPrismaService.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "QUEUED",
            channel: "WHATSAPP",
          }),
        }),
      );
    });

    it("should immediately dispatch notification when tenant has dndEnabled: false feature flag even during night", async () => {
      // Tenant features has dndEnabled: false
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        features: { dndEnabled: false },
      });
      // Second findUnique for dispatchWhatsAppMessage tenant lookup
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });
      mockWhatsAppService.sendTextMessage.mockResolvedValueOnce({
        success: true,
        messageId: "msg-dnd-disabled",
      });
      mockPrismaService.notificationLog.create.mockResolvedValueOnce({
        id: "log-dnd-disabled",
      });

      const result = await service.enqueueNotification({
        tenantId: "tenant-dnd-off",
        recipientPhone: "+5511988887777",
        templateType: "WELCOME_ANAMNESIS",
        clientName: "Fernanda",
      });

      expect(result.status).toBe("SENT");
      expect(result.channel).toBe("WHATSAPP");
      expect(mockWhatsAppService.sendTextMessage).toHaveBeenCalled();
    });
  });

  describe("getTenantQueue", () => {
    it("should return empty queue if user has no tenant", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        tenantId: null,
      });
      const result = await service.getTenantQueue("user-no-tenant", {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.summary.totalQueued).toBe(0);
    });

    it("should return paginated logs and aggregate summary counts", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        tenantId: "tenant-1",
      });
      mockPrismaService.notificationLog.count = jest
        .fn()
        .mockResolvedValueOnce(10) // total matching
        .mockResolvedValueOnce(3) // queued
        .mockResolvedValueOnce(5) // sent
        .mockResolvedValueOnce(2) // failed
        .mockResolvedValueOnce(0); // cancelled
      mockPrismaService.notificationLog.findMany = jest.fn().mockResolvedValue([
        {
          id: "log-1",
          templateType: "WELCOME_ANAMNESIS",
          status: "QUEUED",
          recipientPhone: "11999999999",
        },
      ]);

      const result = await service.getTenantQueue("user-1", {
        status: "QUEUED",
        page: 1,
        limit: 10,
      });
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
      mockPrismaService.client.findUnique.mockResolvedValueOnce({
        id: "client-1",
        userId: "other-user",
        phone: "11999999999",
      });

      await expect(
        service.getClientMessageHistory("user-1", "client-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return notification logs for matching client phone and tenant", async () => {
      mockPrismaService.client.findUnique.mockResolvedValueOnce({
        id: "client-1",
        userId: "user-1",
        phone: "11999999999",
        tenantId: "tenant-1",
      });
      mockPrismaService.notificationLog.findMany = jest.fn().mockResolvedValue([
        {
          id: "log-1",
          recipientPhone: "11999999999",
          status: "SENT",
          templateType: "WORKOUT_LINK",
        },
      ]);

      const result = await service.getClientMessageHistory(
        "user-1",
        "client-1",
      );
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("SENT");
    });
  });

  describe("retryNotification", () => {
    it("should throw ForbiddenException if notification log does not belong to user tenant", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-1",
        tenantId: "tenant-1",
      });
      mockPrismaService.notificationLog.findUnique.mockResolvedValueOnce({
        id: "log-other",
        tenantId: "tenant-other",
      });

      await expect(
        service.retryNotification("user-1", "log-other"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should dispatch via WhatsApp and update log to SENT when WhatsApp is CONNECTED", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        tenantId: "tenant-1",
      });
      mockPrismaService.notificationLog.findUnique.mockResolvedValueOnce({
        id: "log-failed",
        tenantId: "tenant-1",
        recipientPhone: "+5511999998888",
        templateType: "WELCOME_ANAMNESIS",
        status: "FAILED",
      });
      mockPrismaService.tenant.findUnique.mockResolvedValueOnce({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });
      mockWhatsAppService.sendTextMessage.mockResolvedValueOnce({
        success: true,
        messageId: "msg-retry-ok",
      });
      mockPrismaService.notificationLog.update = jest.fn().mockResolvedValue({
        id: "log-failed",
        status: "SENT",
        channel: "WHATSAPP",
      });

      const result = await service.retryNotification("user-1", "log-failed");
      expect(mockWhatsAppService.sendTextMessage).toHaveBeenCalled();
      expect(result.message).toBe("Mensagem reenviada com sucesso.");
      expect(result.notification.status).toBe("SENT");
    });
  });

  describe("cancelNotification", () => {
    it("should mark queued notification as CANCELLED", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        tenantId: "tenant-1",
      });
      mockPrismaService.notificationLog.findUnique.mockResolvedValueOnce({
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

  describe("processPendingQueue (Batch Processor)", () => {
    it("should defer processing when inside DND window", async () => {
      jest.spyOn(service, "calculateDndDelayMs").mockReturnValue(15000000);
      mockPrismaService.notificationLog.count.mockResolvedValueOnce(5);

      const result = await service.processPendingQueue("user-1");
      expect(result.processedCount).toBe(0);
      expect(result.delayedCount).toBe(5);
      expect(result.message).toContain("Horário de silêncio ativo");
    });

    it("should process all queued notifications when outside DND window", async () => {
      jest.spyOn(service, "calculateDndDelayMs").mockReturnValue(0);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        tenantId: "tenant-1",
      });
      mockPrismaService.notificationLog.findMany.mockResolvedValueOnce([
        {
          id: "log-1",
          tenantId: "tenant-1",
          recipientPhone: "+5511999998888",
          templateType: "WELCOME_ANAMNESIS",
          status: "QUEUED",
        },
        {
          id: "log-2",
          tenantId: "tenant-1",
          recipientPhone: "+5511888887777",
          templateType: "WORKOUT_LINK",
          status: "QUEUED",
        },
      ]);

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        whatsappStatus: "CONNECTED",
        whatsappInstanceName: "tenant-vivi-001",
      });

      mockWhatsAppService.sendTextMessage
        .mockResolvedValueOnce({ success: true, messageId: "msg-1" })
        .mockResolvedValueOnce({
          success: false,
          error: "Número de telefone inválido: +5511888887777",
        });

      mockPrismaService.notificationLog.update = jest
        .fn()
        .mockImplementation(({ where, data }) => ({
          id: where.id,
          ...data,
        }));

      const result = await service.processPendingQueue("user-1");

      expect(result.processedCount).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(mockPrismaService.notificationLog.update).toHaveBeenCalledTimes(2);
    });
  });
});
