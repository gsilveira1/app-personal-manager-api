import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  DEFAULT_DND,
  DEFAULT_USER_SETTINGS,
  DEFAULT_WORK_HOURS,
  ResolvedUserSettings,
  UserSettings,
} from "../../../common/types";
import { SettingsPatchBuilder } from "../user-settings.store";
import { SettingsService } from "./settings.service";

describe("SettingsService", () => {
  let store: { read: jest.Mock; patch: jest.Mock };
  let service: SettingsService;
  /** What the last patch builder asked to replace. */
  let lastPatch: UserSettings;

  /** Makes the store behave like the real one over `stored`. */
  function storeHolds(stored: ResolvedUserSettings) {
    store.read.mockResolvedValue(stored);
    store.patch.mockImplementation(
      async (_userId: string, build: SettingsPatchBuilder) => {
        lastPatch = build(stored);
        return { ...stored, ...lastPatch };
      },
    );
  }

  beforeEach(() => {
    store = { read: jest.fn(), patch: jest.fn() };
    service = new SettingsService(store as any);
    storeHolds(DEFAULT_USER_SETTINGS);
  });

  describe("getAiInstructions", () => {
    it("returns the stored instructions", async () => {
      storeHolds({ ...DEFAULT_USER_SETTINGS, aiInstructions: "Be concise." });

      await expect(service.getAiInstructions("user-123")).resolves.toEqual({
        instructions: "Be concise.",
      });
      expect(store.read).toHaveBeenCalledWith("user-123");
    });

    it("returns an empty string when nothing was saved", async () => {
      await expect(service.getAiInstructions("user-123")).resolves.toEqual({
        instructions: "",
      });
    });

    it("bubbles up store errors without masking", async () => {
      store.read.mockRejectedValue(new Error("connection lost"));
      await expect(service.getAiInstructions("user-123")).rejects.toThrow(
        "connection lost",
      );
    });
  });

  describe("updateAiInstructions", () => {
    it("replaces only aiInstructions and returns { instructions }", async () => {
      const result = await service.updateAiInstructions("user-123", "New text");

      expect(store.patch).toHaveBeenCalledWith(
        "user-123",
        expect.any(Function),
      );
      expect(lastPatch).toEqual({ aiInstructions: "New text" });
      expect(result).toEqual({ instructions: "New text" });
    });

    it("is idempotent — calling twice with the same value returns the same result", async () => {
      const first = await service.updateAiInstructions("user-123", "Same");
      const second = await service.updateAiInstructions("user-123", "Same");
      expect(first).toEqual(second);
    });

    it("bubbles up store errors without masking", async () => {
      store.patch.mockRejectedValue(new Error("write failed"));
      await expect(
        service.updateAiInstructions("user-123", "x"),
      ).rejects.toThrow("write failed");
    });
  });

  describe("getLanguage", () => {
    it("returns the stored language", async () => {
      storeHolds({ ...DEFAULT_USER_SETTINGS, language: "en" });
      await expect(service.getLanguage("user-123")).resolves.toEqual({
        language: "en",
      });
    });

    it('returns "pt-BR" as the default', async () => {
      await expect(service.getLanguage("user-123")).resolves.toEqual({
        language: "pt-BR",
      });
    });

    it("propagates the 404 of an unknown user", async () => {
      store.read.mockRejectedValue(new NotFoundException());
      await expect(service.getLanguage("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("updateLanguage", () => {
    it("replaces only language and returns it", async () => {
      const result = await service.updateLanguage("user-123", "es");

      expect(lastPatch).toEqual({ language: "es" });
      expect(result).toEqual({ language: "es" });
    });

    it("is idempotent — calling twice with the same value returns the same result", async () => {
      const first = await service.updateLanguage("user-123", "en");
      const second = await service.updateLanguage("user-123", "en");
      expect(first).toEqual(second);
    });
  });

  describe("work hours", () => {
    it("returns the default week when nothing was saved", async () => {
      await expect(service.getWorkHours("user-123")).resolves.toEqual(
        DEFAULT_WORK_HOURS,
      );
    });

    it("replaces the whole week and returns it", async () => {
      const week = {
        ...DEFAULT_WORK_HOURS,
        sunday: { enabled: true, start: "09:00", end: "11:00" },
        slotDurationMinutes: 45,
      };

      const result = await service.updateWorkHours("user-123", week);

      expect(lastPatch).toEqual({ workHours: week });
      expect(result).toEqual(week);
    });
  });

  describe("updateDnd", () => {
    it("merges the body over the current window and stores the whole object", async () => {
      storeHolds({
        ...DEFAULT_USER_SETTINGS,
        dnd: { enabled: true, startHour: 21, endHour: 7, timezone: "UTC" },
      });

      const result = await service.updateDnd("user-123", { startHour: 23 });

      expect(lastPatch).toEqual({
        dnd: { enabled: true, startHour: 23, endHour: 7, timezone: "UTC" },
      });
      expect(result).toEqual({
        enabled: true,
        startHour: 23,
        endHour: 7,
        timezone: "UTC",
      });
    });

    it("starts from the defaults when no window was ever saved", async () => {
      await service.updateDnd("user-123", { enabled: false });
      expect(lastPatch).toEqual({ dnd: { ...DEFAULT_DND, enabled: false } });
    });

    it("ignores undefined keys instead of erasing stored values", async () => {
      await service.updateDnd("user-123", {
        enabled: undefined,
        endHour: 6,
      });
      expect(lastPatch.dnd).toEqual({ ...DEFAULT_DND, endHour: 6 });
    });

    it("accepts a valid IANA time zone", async () => {
      const result = await service.updateDnd("user-123", {
        timezone: "Europe/Lisbon",
      });
      expect(result.timezone).toBe("Europe/Lisbon");
    });

    it("rejects an unknown time zone with 400 and writes nothing", async () => {
      await expect(
        service.updateDnd("user-123", { timezone: "Mars/Olympus" }),
      ).rejects.toThrow(BadRequestException);
      expect(store.patch).not.toHaveBeenCalled();
    });
  });
});
