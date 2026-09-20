import { Test, TestingModule } from "@nestjs/testing";
import { MessagingService } from "./messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import { AnamnesisService } from "../anamnesis/anamnesis.service";
import { StudentPortalService } from "../student-portal/student-portal.service";

describe("MessagingService", () => {
  let service: MessagingService;
  let prisma: PrismaService;
  let anamnesisService: AnamnesisService;
  let studentPortalService: StudentPortalService;

  const mockPrismaService = {
    client: {
      findUnique: jest.fn(),
    },
    notificationLog: {
      create: jest.fn(),
    },
  };

  const mockAnamnesisService = {
    generateMagicLinkToken: jest
      .fn()
      .mockResolvedValue({ token: "anam-tok", link: "/anamnesis?token=anam-tok" }),
  };

  const mockStudentPortalService = {
    generateWorkoutMagicLink: jest
      .fn()
      .mockResolvedValue({ token: "work-tok", url: "/p/test?token=work-tok" }),
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
    prisma = module.get<PrismaService>(PrismaService);
    anamnesisService = module.get<AnamnesisService>(AnamnesisService);
    studentPortalService = module.get<StudentPortalService>(StudentPortalService);
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
        user: { tenantId: "tenant-1", tenant: { whatsappStatus: "DISCONNECTED" } },
      });
      mockPrismaService.notificationLog.create.mockResolvedValue({ id: "log-1" });

      const result = await service.resendLink("user-1", "client-1", "ANAMNESIS");

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
});
