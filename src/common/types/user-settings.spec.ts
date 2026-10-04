import { BadRequestException } from "@nestjs/common";
import {
  DEFAULT_DND,
  DEFAULT_USER_SETTINGS,
  DEFAULT_WORK_HOURS,
  mergeUserSettings,
  parseUserSettings,
  resolveUserSettings,
} from "./user-settings";

describe("resolveUserSettings", () => {
  it.each([null, undefined, "x", []])("returns defaults for %p", (stored) => {
    expect(resolveUserSettings(stored)).toEqual(DEFAULT_USER_SETTINGS);
  });

  it("keeps stored values and fills the rest", () => {
    const resolved = resolveUserSettings({
      language: "en",
      dnd: { enabled: false, startHour: 20, endHour: 7, timezone: "UTC" },
    });
    expect(resolved.language).toBe("en");
    expect(resolved.dnd.enabled).toBe(false);
    expect(resolved.workHours).toEqual(DEFAULT_WORK_HOURS);
    expect(resolved.aiInstructions).toBe("");
  });
});

describe("parseUserSettings", () => {
  it("accepts an empty document", () => {
    expect(parseUserSettings({})).toEqual({});
  });

  it("accepts a full valid document", () => {
    const full = {
      ...DEFAULT_USER_SETTINGS,
      aiInstructions: "Foco em mobilidade",
    };
    expect(parseUserSettings(full)).toMatchObject({ language: "pt-BR" });
  });

  it("rejects an unsupported language", () => {
    expect(() => parseUserSettings({ language: "fr" })).toThrow(
      BadRequestException,
    );
  });

  it("rejects an hour outside 0-23", () => {
    expect(() =>
      parseUserSettings({ dnd: { ...DEFAULT_DND, startHour: 24 } }),
    ).toThrow(BadRequestException);
  });

  it("rejects work hours that are not HH:mm", () => {
    const workHours = {
      ...DEFAULT_WORK_HOURS,
      monday: { enabled: true, start: "7h", end: "19:00" },
    };
    expect(() => parseUserSettings({ workHours })).toThrow(BadRequestException);
  });

  it("rejects unknown keys", () => {
    expect(() => parseUserSettings({ theme: "dark" })).toThrow(
      BadRequestException,
    );
  });
});

describe("mergeUserSettings", () => {
  it("replaces only the patched keys", () => {
    const merged = mergeUserSettings(
      { language: "en", aiInstructions: "abc" },
      { language: "es" },
    );
    expect(merged).toMatchObject({ language: "es", aiInstructions: "abc" });
  });

  it("starts from an empty document when nothing is stored", () => {
    expect(mergeUserSettings(null, { language: "en" })).toMatchObject({
      language: "en",
    });
  });

  it("validates the merged result", () => {
    expect(() => mergeUserSettings({}, { language: "de" as never })).toThrow(
      BadRequestException,
    );
  });
});
