import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DEFAULT_WORK_HOURS } from "../../../common/types";
import {
  UpdateAiInstructionsDto,
  UpdateDndDto,
  UpdateLanguageDto,
  UpdateWorkHoursDto,
} from "./settings.dto";

const PIPE = { whitelist: true, forbidNonWhitelisted: true };

function check<T extends object>(cls: new () => T, plain: object) {
  return validate(plainToInstance(cls, plain), PIPE);
}

describe("UpdateLanguageDto", () => {
  it.each(["en", "es", "pt-BR"])('accepts "%s"', async (language) => {
    expect(await check(UpdateLanguageDto, { language })).toHaveLength(0);
  });

  it('rejects the unsupported locale "fr" with the supported list in the message', async () => {
    const errors = await check(UpdateLanguageDto, { language: "fr" });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isIn).toMatch(/en.*es.*pt-BR/);
  });

  it.each([["pt"], [""], [undefined], [42]])("rejects %p", async (language) => {
    const errors = await check(UpdateLanguageDto, { language });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("UpdateAiInstructionsDto", () => {
  it("accepts a string, including an empty one", async () => {
    expect(
      await check(UpdateAiInstructionsDto, { instructions: "" }),
    ).toHaveLength(0);
  });

  it("rejects a missing or non-string value", async () => {
    expect(await check(UpdateAiInstructionsDto, {})).toHaveLength(1);
    expect(
      await check(UpdateAiInstructionsDto, { instructions: 5 }),
    ).toHaveLength(1);
  });

  it("rejects more than 10 000 characters", async () => {
    const errors = await check(UpdateAiInstructionsDto, {
      instructions: "a".repeat(10_001),
    });
    expect(errors[0].constraints).toHaveProperty("maxLength");
  });
});

describe("UpdateWorkHoursDto", () => {
  it("accepts a whole week", async () => {
    expect(await check(UpdateWorkHoursDto, DEFAULT_WORK_HOURS)).toHaveLength(0);
  });

  it("rejects a start that is not HH:mm", async () => {
    const errors = await check(UpdateWorkHoursDto, {
      ...DEFAULT_WORK_HOURS,
      monday: { enabled: true, start: "7am", end: "19:00" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("monday");
  });

  it("rejects a missing day", async () => {
    const { sunday: _sunday, ...withoutSunday } = DEFAULT_WORK_HOURS;
    const errors = await check(UpdateWorkHoursDto, withoutSunday);
    expect(errors.some((e) => e.property === "sunday")).toBe(true);
  });

  it("rejects a null day", async () => {
    const errors = await check(UpdateWorkHoursDto, {
      ...DEFAULT_WORK_HOURS,
      friday: null,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("friday");
  });

  it.each([10, 121, 30.5])(
    "rejects slotDurationMinutes %p",
    async (slotDurationMinutes) => {
      const errors = await check(UpdateWorkHoursDto, {
        ...DEFAULT_WORK_HOURS,
        slotDurationMinutes,
      });
      expect(errors[0].property).toBe("slotDurationMinutes");
    },
  );
});

describe("UpdateDndDto", () => {
  it("validates a full payload", async () => {
    const errors = await check(UpdateDndDto, {
      enabled: false,
      startHour: 23,
      endHour: 7,
      timezone: "America/Sao_Paulo",
    });
    expect(errors).toHaveLength(0);
  });

  it("allows an empty payload (every key is optional)", async () => {
    expect(await check(UpdateDndDto, {})).toHaveLength(0);
  });

  it("fails when an hour is out of the 0-23 range", async () => {
    const errors = await check(UpdateDndDto, { startHour: 25, endHour: -1 });
    expect(errors).toHaveLength(2);
  });

  it("fails when enabled is not a boolean", async () => {
    const errors = await check(UpdateDndDto, { enabled: "invalid-boolean" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects the old dnd* key names", async () => {
    const errors = await check(UpdateDndDto, { dndEnabled: true });
    expect(errors[0].constraints).toHaveProperty("whitelistValidation");
  });
});
