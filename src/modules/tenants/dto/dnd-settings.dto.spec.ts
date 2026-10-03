import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateDndSettingsDto } from "./dnd-settings.dto";

describe("UpdateDndSettingsDto", () => {
  it("should validate valid DND settings payload", async () => {
    const payload = {
      dndEnabled: false,
      dndStartHour: 23,
      dndEndHour: 7,
      dndTimezone: "America/Sao_Paulo",
    };

    const instance = plainToInstance(UpdateDndSettingsDto, payload);
    const errors = await validate(instance);
    expect(errors.length).toBe(0);
  });

  it("should allow empty / optional payload", async () => {
    const instance = plainToInstance(UpdateDndSettingsDto, {});
    const errors = await validate(instance);
    expect(errors.length).toBe(0);
  });

  it("should fail validation if hour is out of 0-23 range", async () => {
    const payload = {
      dndStartHour: 25,
      dndEndHour: -1,
    };

    const instance = plainToInstance(UpdateDndSettingsDto, payload);
    const errors = await validate(instance);
    expect(errors.length).toBe(2);
  });

  it("should fail validation if dndEnabled is not boolean", async () => {
    const payload = {
      dndEnabled: "invalid-boolean",
    };

    const instance = plainToInstance(UpdateDndSettingsDto, payload);
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
  });
});
