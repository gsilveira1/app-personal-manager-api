import "reflect-metadata";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateSessionDto, UpdateSessionDto } from "./session.dto";

const propertiesWithErrors = async (dto: object) =>
  (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

describe("CreateSessionDto", () => {
  const createDto = (data: Record<string, any>): CreateSessionDto =>
    plainToInstance(CreateSessionDto, data);

  const validData = {
    date: "2025-02-01T10:00:00.000Z",
    durationMinutes: 60,
    type: "In-Person",
    category: "Workout",
    clientId: "550e8400-e29b-41d4-a716-446655440000",
  };

  it("should pass with valid required fields", async () => {
    expect(await propertiesWithErrors(createDto(validData))).toEqual([]);
  });

  it("should pass with optional fields", async () => {
    const dto = createDto({
      ...validData,
      workoutSheetId: "550e8400-e29b-41d4-a716-446655440001",
      workoutSegmentId: "item-A_1",
      notes: "Treino pesado",
      completed: false,
    });
    expect(await propertiesWithErrors(dto)).toEqual([]);
  });

  it("should fail when date is missing", async () => {
    const { date, ...noDate } = validData;
    expect(await propertiesWithErrors(createDto(noDate))).toContain("date");
  });

  it("should report an unparseable date as a validation error instead of throwing (regression)", async () => {
    const dto = createDto({ ...validData, date: "not-a-date" });
    expect(await propertiesWithErrors(dto)).toContain("date");
  });

  it("should fail when durationMinutes is not an integer", async () => {
    const dto = createDto({ ...validData, durationMinutes: 60.5 });
    expect(await propertiesWithErrors(dto)).toContain("durationMinutes");
  });

  it("should fail when durationMinutes is less than 1", async () => {
    const dto = createDto({ ...validData, durationMinutes: 0 });
    expect(await propertiesWithErrors(dto)).toContain("durationMinutes");
  });

  it("should fail when clientId is not a UUID", async () => {
    const dto = createDto({ ...validData, clientId: "not-a-uuid" });
    expect(await propertiesWithErrors(dto)).toContain("clientId");
  });

  it("should fail when type is missing", async () => {
    const { type, ...noType } = validData;
    expect(await propertiesWithErrors(createDto(noType))).toContain("type");
  });

  it("should fail when type is neither In-Person nor Online", async () => {
    const dto = createDto({ ...validData, type: "Hybrid" });
    expect(await propertiesWithErrors(dto)).toContain("type");
  });

  it("should fail when category is missing", async () => {
    const { category, ...noCat } = validData;
    expect(await propertiesWithErrors(createDto(noCat))).toContain("category");
  });

  it("should reject the removed linkedWorkoutId property", async () => {
    const dto = createDto({
      ...validData,
      linkedWorkoutId: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(await propertiesWithErrors(dto)).toContain("linkedWorkoutId");
  });

  it("should fail when workoutSheetId is not a UUID", async () => {
    const dto = createDto({ ...validData, workoutSheetId: "sheet" });
    expect(await propertiesWithErrors(dto)).toContain("workoutSheetId");
  });

  it("should fail when workoutSegmentId has characters outside the id alphabet", async () => {
    const dto = createDto({ ...validData, workoutSegmentId: "a b" });
    expect(await propertiesWithErrors(dto)).toContain("workoutSegmentId");
  });

  describe("series (rrule)", () => {
    const series = {
      ...validData,
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12",
      timezone: "America/Sao_Paulo",
    };

    it("should pass with rrule and timezone", async () => {
      expect(await propertiesWithErrors(createDto(series))).toEqual([]);
    });

    it("should pass without timezone (the service applies the default)", async () => {
      const { timezone, ...noTz } = series;
      expect(await propertiesWithErrors(createDto(noTz))).toEqual([]);
    });

    it("should fail when rrule does not start with FREQ=", async () => {
      const dto = createDto({ ...series, rrule: "INVALID_RRULE" });
      expect(await propertiesWithErrors(dto)).toContain("rrule");
    });

    it("should reject the old dtstart property (it is `date` now)", async () => {
      const dto = createDto({ ...series, dtstart: "2025-01-06T10:00:00Z" });
      expect(await propertiesWithErrors(dto)).toContain("dtstart");
    });
  });
});

describe("UpdateSessionDto", () => {
  const updateDto = (data: Record<string, any>): UpdateSessionDto =>
    plainToInstance(UpdateSessionDto, data);

  it("should pass with an empty body", async () => {
    expect(await propertiesWithErrors(updateDto({}))).toEqual([]);
  });

  it("should pass with every field of an occurrence edit", async () => {
    const dto = updateDto({
      date: "2025-01-14T14:00:00.000Z",
      durationMinutes: 45,
      type: "Online",
      category: "Check-in",
      notes: "Remarcado",
      completed: false,
      cancelled: true,
    });
    expect(await propertiesWithErrors(dto)).toEqual([]);
  });

  it("should accept null to unlink the workout", async () => {
    const dto = updateDto({ workoutSheetId: null, workoutSegmentId: null });
    expect(await propertiesWithErrors(dto)).toEqual([]);
  });

  it("should fail when durationMinutes is less than 1", async () => {
    const dto = updateDto({ durationMinutes: 0 });
    expect(await propertiesWithErrors(dto)).toContain("durationMinutes");
  });

  it("should fail when date is invalid", async () => {
    expect(
      await propertiesWithErrors(updateDto({ date: "bad-date" })),
    ).toContain("date");
  });

  it.each([
    "date",
    "durationMinutes",
    "type",
    "category",
    "completed",
    "cancelled",
  ])("should fail when %s is null", async (property) => {
    const dto = updateDto({ [property]: null });
    expect(await propertiesWithErrors(dto)).toContain(property);
  });

  it.each(["clientId", "rrule", "scope", "newStartTime", "recurringEventId"])(
    "should reject %s (not editable through PATCH)",
    async (property) => {
      const dto = updateDto({ [property]: "x" });
      expect(await propertiesWithErrors(dto)).toContain(property);
    },
  );
});
