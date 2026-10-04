import { Test } from "@nestjs/testing";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  let controller: UsersController;
  const service = {
    updateProfile: jest.fn(),
    generateAvatarUploadUrl: jest.fn(),
    updateBranding: jest.fn(),
    completeSetup: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();
    controller = module.get(UsersController);
  });

  it("updates the caller's own profile", async () => {
    service.updateProfile.mockResolvedValue({ id: "u1", name: "Novo" });

    const result = await controller.updateProfile("u1", { name: "Novo" });

    expect(service.updateProfile).toHaveBeenCalledWith("u1", { name: "Novo" });
    expect(result).toEqual({ id: "u1", name: "Novo" });
  });

  it("asks for an avatar upload URL with the content type", async () => {
    service.generateAvatarUploadUrl.mockResolvedValue({ uploadUrl: "u" });

    await controller.generateAvatarUploadUrl("u1", {
      contentType: "image/png",
    });

    expect(service.generateAvatarUploadUrl).toHaveBeenCalledWith(
      "u1",
      "image/png",
    );
  });

  it("updates branding", async () => {
    const dto = { primaryColor: "#FF0000" };
    service.updateBranding.mockResolvedValue({ id: "u1", ...dto });

    const result = await controller.updateBranding("u1", dto);

    expect(service.updateBranding).toHaveBeenCalledWith("u1", dto);
    expect(result).toEqual({ id: "u1", primaryColor: "#FF0000" });
  });

  it("completes the setup", async () => {
    service.completeSetup.mockResolvedValue({ success: true, user: {} });

    const result = await controller.completeSetup("u1");

    expect(service.completeSetup).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ success: true, user: {} });
  });
});
