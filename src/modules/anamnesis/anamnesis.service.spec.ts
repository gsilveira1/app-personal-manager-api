import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { AnamnesisService } from "./anamnesis.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";

describe("AnamnesisService", () => {
  let service: AnamnesisService;
  let prisma: PrismaService;
  let jwt: JwtService;

  const mockPrismaService = {
    client: {
      findUnique: jest.fn(),
    },
    anamnesis: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    evaluation: {
      create: jest.fn(),
    },
    notificationLog: {
      create: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue("mock-token-123"),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnamnesisService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AnamnesisService>(AnamnesisService);
    prisma = module.get<PrismaService>(PrismaService);
    jwt = module.get<JwtService>(JwtService);
    jest.clearAllMocks();
  });

  it("should generate magic link token", async () => {
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      userId: "user-1",
      user: { tenantId: "tenant-1" },
    });
    mockPrismaService.anamnesis.create.mockResolvedValue({ id: "anam-1" });

    const result = await service.generateMagicLinkToken("user-1", "client-1");
    expect(result.token).toBe("mock-token-123");
    expect(result.link).toContain("token=mock-token-123");
    expect(mockPrismaService.anamnesis.create).toHaveBeenCalled();
  });

  it("should get form metadata for valid token", async () => {
    mockJwtService.verify.mockReturnValue({
      clientId: "client-1",
      userId: "user-1",
      action: "ANAMNESIS",
    });
    mockPrismaService.anamnesis.findFirst.mockResolvedValue({
      id: "anam-1",
      token: "mock-token",
      tokenUsed: false,
    });
    mockPrismaService.client.findUnique.mockResolvedValue({
      id: "client-1",
      name: "Mariana Souza",
      user: {
        name: "Viviana Personal",
        tenant: { primaryColor: "#10B981", logoUrl: "https://logo.png" },
      },
    });

    const result = await service.getFormMetadata("mock-token");
    expect(result.studentName).toBe("Mariana Souza");
    expect(result.personalName).toBe("Viviana Personal");
    expect(result.theme.primaryColor).toBe("#10B981");
  });

  it("should reject submission if token is already used", async () => {
    mockJwtService.verify.mockReturnValue({
      clientId: "client-1",
      action: "ANAMNESIS",
    });
    mockPrismaService.anamnesis.findFirst.mockResolvedValue(null);

    await expect(
      service.submitAnamnesis({
        token: "used-token",
        medicalHistory: "none",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("should successfully submit anamnesis and invalidate token", async () => {
    mockJwtService.verify.mockReturnValue({
      clientId: "client-1",
      action: "ANAMNESIS",
    });
    mockPrismaService.anamnesis.findFirst.mockResolvedValue({
      id: "anam-1",
      tokenUsed: false,
    });
    mockPrismaService.anamnesis.updateMany.mockResolvedValue({ count: 1 });
    mockPrismaService.anamnesis.update.mockResolvedValue({
      id: "anam-1",
      tokenUsed: true,
      isCurrent: true,
    });
    mockPrismaService.evaluation.create.mockResolvedValue({ id: "eval-1" });

    const result = await service.submitAnamnesis({
      token: "valid-token",
      medicalHistory: "none",
      weightKg: 65,
    });

    expect(result.message).toContain("sucesso");
    expect(mockPrismaService.anamnesis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "anam-1" },
        data: expect.objectContaining({ tokenUsed: true, isCurrent: true }),
      }),
    );
    expect(mockPrismaService.evaluation.create).toHaveBeenCalled();
  });
});
