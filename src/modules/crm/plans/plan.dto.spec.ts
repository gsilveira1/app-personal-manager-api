import "reflect-metadata";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreatePlanDto, UpdatePlanDto } from "./plan.dto";

async function check<T extends object>(
  cls: ClassConstructor<T>,
  data: Record<string, unknown>,
) {
  const dto = plainToInstance(cls, data);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors, invalid: errors.map((error) => error.property) };
}

describe("CreatePlanDto", () => {
  const validData = {
    type: "PRESENCIAL",
    name: "Plano Básico",
    sessionsPerWeek: 3,
    price: 200,
  };

  it("passes with the required fields", async () => {
    expect((await check(CreatePlanDto, validData)).errors).toHaveLength(0);
  });

  it("passes with CONSULTORIA and price 0", async () => {
    const { errors } = await check(CreatePlanDto, {
      ...validData,
      type: "CONSULTORIA",
      price: 0,
    });
    expect(errors).toHaveLength(0);
  });

  it.each([[30], [45], [60], [90]])(
    "passes with durationMinutes %d",
    async (durationMinutes) => {
      const { errors } = await check(CreatePlanDto, {
        ...validData,
        durationMinutes,
      });
      expect(errors).toHaveLength(0);
    },
  );

  it.each([
    ["type", "INVALID"],
    ["sessionsPerWeek", 0],
    ["sessionsPerWeek", 7],
    ["durationMinutes", 50],
    ["price", -1],
    ["name", undefined],
  ])("fails when %s is %p", async (property, value) => {
    const { invalid } = await check(CreatePlanDto, {
      ...validData,
      [property]: value,
    });
    expect(invalid).toContain(property);
  });

  it("accepts known feature keys", async () => {
    const { errors } = await check(CreatePlanDto, {
      ...validData,
      features: ["automated_pix", "advanced_metrics"],
    });
    expect(errors).toHaveLength(0);
  });

  it.each([
    [["not_a_feature"]],
    [["automated_pix", "automated_pix"]],
    ["automated_pix"],
    [["550e8400-e29b-41d4-a716-446655440000"]],
  ])("rejects features %p", async (features) => {
    const { invalid } = await check(CreatePlanDto, { ...validData, features });
    expect(invalid).toContain("features");
  });

  it("rejects the old featureIds property and a forged userId", async () => {
    const { invalid } = await check(CreatePlanDto, {
      ...validData,
      featureIds: ["550e8400-e29b-41d4-a716-446655440000"],
      userId: "someone-else",
    });
    expect(invalid).toEqual(expect.arrayContaining(["featureIds", "userId"]));
  });
});

describe("UpdatePlanDto", () => {
  it("passes with an empty body and with a single field", async () => {
    expect((await check(UpdatePlanDto, {})).errors).toHaveLength(0);
    expect((await check(UpdatePlanDto, { price: 250 })).errors).toHaveLength(0);
  });

  // Regression: PATCH /plans/:id took `Partial<CreatePlanDto>`, an interface type the
  // ValidationPipe cannot see, so any body reached Prisma unvalidated.
  it.each([
    ["price", -5],
    ["sessionsPerWeek", 99],
    ["type", "X"],
    ["features", ["nope"]],
    ["userId", "someone-else"],
  ])("validates %s on PATCH", async (property, value) => {
    const { invalid } = await check(UpdatePlanDto, { [property]: value });
    expect(invalid).toContain(property);
  });
});

describe("CreatePlanDto bounds (review M2)", () => {
  const validData = {
    type: "PRESENCIAL",
    name: "Plano Básico",
    sessionsPerWeek: 3,
    price: 200,
  };

  it("rejects a name longer than 200 characters", async () => {
    const { invalid } = await check(CreatePlanDto, {
      ...validData,
      name: "a".repeat(201),
    });
    expect(invalid).toContain("name");
  });

  it("rejects a price above 1,000,000", async () => {
    const { invalid } = await check(CreatePlanDto, {
      ...validData,
      price: 1_000_001,
    });
    expect(invalid).toContain("price");
  });

  it("rejects more features than the catalogue has", async () => {
    const { invalid } = await check(CreatePlanDto, {
      ...validData,
      features: Array.from({ length: 21 }, (_, i) => `feature_${i}`),
    });
    expect(invalid).toContain("features");
  });
});
