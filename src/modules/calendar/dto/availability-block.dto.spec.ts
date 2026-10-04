import "reflect-metadata";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import {
  CreateAvailabilityBlockDto,
  UpdateAvailabilityBlockDto,
} from "./availability-block.dto";

const propertiesWithErrors = async (dto: object) =>
  (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

describe("CreateAvailabilityBlockDto", () => {
  const valid = {
    title: "Almoço",
    dtstart: "2025-01-15T12:00:00Z",
    dtend: "2025-01-15T13:00:00Z",
  };
  const createDto = (data: Record<string, any>) =>
    plainToInstance(CreateAvailabilityBlockDto, data);

  it("should pass with the required fields", async () => {
    expect(await propertiesWithErrors(createDto(valid))).toEqual([]);
  });

  it("should pass with rrule, timezone and notes", async () => {
    const dto = createDto({
      ...valid,
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      timezone: "America/Sao_Paulo",
      notes: "Todos os dias úteis",
    });
    expect(await propertiesWithErrors(dto)).toEqual([]);
  });

  it.each(["title", "dtstart", "dtend"])(
    "should fail when %s is missing",
    async (property) => {
      const { [property]: _removed, ...rest } = valid as Record<string, string>;
      expect(await propertiesWithErrors(createDto(rest))).toContain(property);
    },
  );

  it("should fail when title is empty", async () => {
    const dto = createDto({ ...valid, title: "" });
    expect(await propertiesWithErrors(dto)).toContain("title");
  });

  it("should fail when rrule does not start with FREQ=", async () => {
    const dto = createDto({ ...valid, rrule: "TOTALLY_INVALID" });
    expect(await propertiesWithErrors(dto)).toContain("rrule");
  });

  it("should fail when dtend is not a date", async () => {
    const dto = createDto({ ...valid, dtend: "later" });
    expect(await propertiesWithErrors(dto)).toContain("dtend");
  });
});

describe("UpdateAvailabilityBlockDto", () => {
  const updateDto = (data: Record<string, any>) =>
    plainToInstance(UpdateAvailabilityBlockDto, data);

  it("should pass with an empty body", async () => {
    expect(await propertiesWithErrors(updateDto({}))).toEqual([]);
  });

  it("should accept null for rrule and notes", async () => {
    const dto = updateDto({ rrule: null, notes: null });
    expect(await propertiesWithErrors(dto)).toEqual([]);
  });

  it.each(["title", "dtstart", "dtend", "timezone"])(
    "should fail when %s is null",
    async (property) => {
      const dto = updateDto({ [property]: null });
      expect(await propertiesWithErrors(dto)).toContain(property);
    },
  );

  it("should reject unknown properties", async () => {
    const dto = updateDto({ userId: "someone-else" });
    expect(await propertiesWithErrors(dto)).toContain("userId");
  });
});
