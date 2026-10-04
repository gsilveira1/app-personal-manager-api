import { Test, TestingModule } from "@nestjs/testing";
import { DEFAULT_DND, DEFAULT_WORK_HOURS } from "../../../common/types";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

const mockSettingsService = {
  getAiInstructions: jest.fn(),
  updateAiInstructions: jest.fn(),
  getLanguage: jest.fn(),
  updateLanguage: jest.fn(),
  getWorkHours: jest.fn(),
  updateWorkHours: jest.fn(),
  updateDnd: jest.fn(),
};

describe("SettingsController", () => {
  let controller: SettingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: mockSettingsService }],
    }).compile();
    controller = module.get(SettingsController);
    jest.clearAllMocks();
  });

  it("getAiInstructions delegates the userId", async () => {
    mockSettingsService.getAiInstructions.mockResolvedValue({
      instructions: "",
    });

    await expect(controller.getAiInstructions("u1")).resolves.toEqual({
      instructions: "",
    });
    expect(mockSettingsService.getAiInstructions).toHaveBeenCalledWith("u1");
  });

  it("updateAiInstructions delegates the userId and the text", async () => {
    mockSettingsService.updateAiInstructions.mockResolvedValue({
      instructions: "x",
    });

    const result = await controller.updateAiInstructions("u1", {
      instructions: "x",
    });

    expect(mockSettingsService.updateAiInstructions).toHaveBeenCalledWith(
      "u1",
      "x",
    );
    expect(result).toEqual({ instructions: "x" });
  });

  describe("getLanguage", () => {
    it("returns the service result for the authenticated user", async () => {
      mockSettingsService.getLanguage.mockResolvedValue({ language: "en" });
      await expect(controller.getLanguage("u1")).resolves.toEqual({
        language: "en",
      });
    });

    it("delegates the correct userId to the service", async () => {
      mockSettingsService.getLanguage.mockResolvedValue({ language: "pt-BR" });
      await controller.getLanguage("user-abc");
      expect(mockSettingsService.getLanguage).toHaveBeenCalledWith("user-abc");
    });
  });

  describe("updateLanguage", () => {
    it("returns the updated language for a valid locale", async () => {
      mockSettingsService.updateLanguage.mockResolvedValue({ language: "es" });
      await expect(
        controller.updateLanguage("u1", { language: "es" }),
      ).resolves.toEqual({ language: "es" });
    });

    it("delegates the correct userId and language to the service", async () => {
      mockSettingsService.updateLanguage.mockResolvedValue({ language: "en" });
      await controller.updateLanguage("user-xyz", { language: "en" });
      expect(mockSettingsService.updateLanguage).toHaveBeenCalledWith(
        "user-xyz",
        "en",
      );
    });
  });

  it("getWorkHours and updateWorkHours delegate to the service", async () => {
    mockSettingsService.getWorkHours.mockResolvedValue(DEFAULT_WORK_HOURS);
    mockSettingsService.updateWorkHours.mockResolvedValue(DEFAULT_WORK_HOURS);

    await expect(controller.getWorkHours("u1")).resolves.toBe(
      DEFAULT_WORK_HOURS,
    );
    await controller.updateWorkHours("u1", DEFAULT_WORK_HOURS);

    expect(mockSettingsService.updateWorkHours).toHaveBeenCalledWith(
      "u1",
      DEFAULT_WORK_HOURS,
    );
  });

  it("updateDnd delegates the partial window (PATCH /settings/dnd)", async () => {
    mockSettingsService.updateDnd.mockResolvedValue({
      ...DEFAULT_DND,
      startHour: 23,
    });

    const result = await controller.updateDnd("u1", { startHour: 23 });

    expect(mockSettingsService.updateDnd).toHaveBeenCalledWith("u1", {
      startHour: 23,
    });
    expect(result.startHour).toBe(23);
  });
});
