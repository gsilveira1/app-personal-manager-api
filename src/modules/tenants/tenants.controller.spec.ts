import { Test, TestingModule } from "@nestjs/testing";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";
import { UpdateBrandingDto } from "./dto/branding.dto";
import { RequestWithUser } from "../../types/global";
import { WhatsappStatus } from "@prisma/client";

describe("TenantsController", () => {
  let controller: TenantsController;
  let service: TenantsService;

  const mockTenantsService = {
    getOrCreateTenantForUser: jest.fn(),
    updateBranding: jest.fn(),
    updateDndSettings: jest.fn(),
    connectWhatsapp: jest.fn(),
    getWhatsappStatus: jest.fn(),
    disconnectWhatsapp: jest.fn(),
    sendTestWhatsappMessage: jest.fn(),
    completeSetup: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        {
          provide: TenantsService,
          useValue: mockTenantsService,
        },
      ],
    }).compile();

    controller = module.get<TenantsController>(TenantsController);
    service = module.get<TenantsService>(TenantsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should get tenant for authenticated user", async () => {
    const mockTenant = {
      id: "tenant-1",
      name: "Studio",
      setupCompleted: false,
    };
    mockTenantsService.getOrCreateTenantForUser.mockResolvedValue(mockTenant);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.getMyTenant(req);

    expect(result).toEqual(mockTenant);
    expect(service.getOrCreateTenantForUser).toHaveBeenCalledWith("user-1");
  });

  it("should update branding", async () => {
    const dto: UpdateBrandingDto = {
      logoUrl: "https://pub-r2.viviops.com/logos/logo.png",
      primaryColor: "#10B981",
    };
    const mockUpdatedTenant = { id: "tenant-1", ...dto };
    mockTenantsService.updateBranding.mockResolvedValue(mockUpdatedTenant);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.updateBranding(req, dto);

    expect(result).toEqual(mockUpdatedTenant);
    expect(service.updateBranding).toHaveBeenCalledWith("user-1", dto);
  });

  it("should update DND settings via patch /dnd-settings", async () => {
    const dto = {
      dndEnabled: false,
      dndStartHour: 23,
      dndEndHour: 7,
      dndTimezone: "America/Sao_Paulo",
    };
    const mockUpdatedTenant = {
      id: "tenant-1",
      features: { ...dto },
    };
    mockTenantsService.updateDndSettings.mockResolvedValue(mockUpdatedTenant);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.updateDndSettings(req, dto);

    expect(result).toEqual(mockUpdatedTenant);
    expect(mockTenantsService.updateDndSettings).toHaveBeenCalledWith(
      "user-1",
      dto,
    );
  });

  it("should connect whatsapp via whatsapp/connect", async () => {
    const mockResponse = {
      instanceName: "tenant-1",
      qrcodeBase64: "data:image/png;base64,123",
      status: WhatsappStatus.PENDING,
    };
    mockTenantsService.connectWhatsapp.mockResolvedValue(mockResponse);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.connectWhatsapp(req);

    expect(result).toEqual(mockResponse);
    expect(service.connectWhatsapp).toHaveBeenCalledWith("user-1");
  });

  it("should connect whatsapp via setup/connect-whatsapp", async () => {
    const mockResponse = {
      instanceName: "tenant-1",
      qrcodeBase64: "data:image/png;base64,123",
      status: WhatsappStatus.PENDING,
    };
    mockTenantsService.connectWhatsapp.mockResolvedValue(mockResponse);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.connectWhatsappSetup(req);

    expect(result).toEqual(mockResponse);
    expect(service.connectWhatsapp).toHaveBeenCalledWith("user-1");
  });

  it("should get whatsapp status", async () => {
    const mockStatus = {
      instanceName: "tenant-1",
      status: WhatsappStatus.CONNECTED,
    };
    mockTenantsService.getWhatsappStatus.mockResolvedValue(mockStatus);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.getWhatsappStatus(req);

    expect(result).toEqual(mockStatus);
    expect(service.getWhatsappStatus).toHaveBeenCalledWith("user-1");
  });

  it("should complete setup", async () => {
    const mockResponse = {
      success: true,
      tenant: { id: "tenant-1", setupCompleted: true },
    };
    mockTenantsService.completeSetup.mockResolvedValue(mockResponse);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.completeSetup(req);

    expect(result).toEqual(mockResponse);
    expect(service.completeSetup).toHaveBeenCalledWith("user-1");
  });

  it("should disconnect whatsapp via whatsapp/disconnect", async () => {
    const mockResponse = {
      success: true,
      status: WhatsappStatus.DISCONNECTED,
      instanceName: "tenant-1",
    };
    mockTenantsService.disconnectWhatsapp = jest
      .fn()
      .mockResolvedValue(mockResponse);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const result = await controller.disconnectWhatsapp(req);

    expect(result).toEqual(mockResponse);
    expect(mockTenantsService.disconnectWhatsapp).toHaveBeenCalledWith(
      "user-1",
    );
  });

  it("should send test message via whatsapp/test-message", async () => {
    const mockResponse = {
      success: true,
      messageId: "msg-123",
    };
    mockTenantsService.sendTestWhatsappMessage = jest
      .fn()
      .mockResolvedValue(mockResponse);

    const req = { user: { userId: "user-1" } } as RequestWithUser;
    const dto = { phone: "5553999999999", message: "Hello test" };
    const result = await controller.sendTestMessage(req, dto);

    expect(result).toEqual(mockResponse);
    expect(mockTenantsService.sendTestWhatsappMessage).toHaveBeenCalledWith(
      "user-1",
      dto,
    );
  });
});
