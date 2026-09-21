import { Test, TestingModule } from "@nestjs/testing";
import { AdminTenantsService } from "./admin-tenants.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConflictException } from "@nestjs/common";

describe("AdminTenantsService", () => {
  let service: AdminTenantsService;
  let _prisma: PrismaService;

  const mockPrismaService = {
    tenant: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminTenantsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AdminTenantsService>(AdminTenantsService);
    _prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it("should list tenants with student counts and features", async () => {
    mockPrismaService.tenant.count.mockResolvedValue(1);
    mockPrismaService.tenant.findMany.mockResolvedValue([
      {
        id: "tenant-1",
        name: "Viviana Consultoria",
        slug: "viviana",
        status: "ACTIVE",
        features: { maxStudents: 50, canUploadVideos: true },
        createdAt: new Date(),
        users: [{ _count: { clients: 12 } }],
      },
    ]);

    const result = await service.findAll({ page: 1, limit: 10 });
    expect(result.total).toBe(1);
    expect(result.items[0].studentsCount).toBe(12);
    expect((result.items[0].features as any).maxStudents).toBe(50);
  });

  it("should create a new tenant with feature flags", async () => {
    mockPrismaService.tenant.findUnique.mockResolvedValue(null);
    mockPrismaService.tenant.create.mockResolvedValue({
      id: "tenant-2",
      name: "Novo Personal",
      slug: "novo-personal",
      status: "ACTIVE",
      features: {
        maxStudents: 30,
        canUploadVideos: true,
        whatsappAlerts: true,
      },
    });

    const result = await service.create({
      name: "Novo Personal",
      slug: "novo-personal",
      email: "novo@example.com",
      maxStudents: 30,
    });

    expect(result.id).toBe("tenant-2");
    expect(mockPrismaService.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "novo-personal",
          features: expect.objectContaining({ maxStudents: 30 }),
        }),
      }),
    );
  });

  it("should fail creating tenant if slug already exists", async () => {
    mockPrismaService.tenant.findUnique.mockResolvedValue({ id: "existing" });

    await expect(
      service.create({
        name: "Duplicate",
        slug: "existing-slug",
        email: "dup@example.com",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("should update tenant status and feature flags", async () => {
    mockPrismaService.tenant.findUnique.mockResolvedValue({ id: "tenant-1" });
    mockPrismaService.tenant.update.mockResolvedValue({
      id: "tenant-1",
      status: "BLOCKED",
      features: { maxStudents: 100 },
    });

    const result = await service.update("tenant-1", {
      status: "BLOCKED",
      features: { maxStudents: 100 },
    });

    expect(result.status).toBe("BLOCKED");
  });
});
