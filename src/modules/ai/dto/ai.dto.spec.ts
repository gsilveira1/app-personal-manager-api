import "reflect-metadata";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { GenerateWorkoutInsightsDto } from "./generate-workout-insights.dto";
import { GenerateWorkoutPlanDto } from "./generate-workout-plan.dto";

/** Same options as the global ValidationPipe. */
const PIPE = { whitelist: true, forbidNonWhitelisted: true };

function check<T extends object>(cls: ClassConstructor<T>, plain: object) {
  const dto = plainToInstance(cls, plain);
  const errors = validateSync(dto, PIPE);
  return { dto, invalid: errors.map((error) => error.property) };
}

/** What the trainer dashboard (client v1) sends as `client`: the whole Client view. */
const dashboardClient = {
  id: "c-1",
  name: "Maria Silva",
  email: "maria@example.com",
  phone: "53999001122",
  status: "ACTIVE",
  modality: "PRESENCIAL",
  goal: "Emagrecimento",
  notes: "Joelho direito sensível",
  dateOfBirth: "1990-05-20T00:00:00.000Z",
  avatar: null,
  planId: "p-1",
  plan: { id: "p-1", name: "Plano" },
  activeWorkoutSheet: null,
  notificationEnabled: true,
  medicalHistory: {
    objective: ["Saúde"],
    injuries: "Joelho",
    hasHeartDisease: false,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
};
const dashboardEvaluation = {
  id: "e-1",
  clientId: "c-1",
  date: "2026-09-01",
  weight: 65,
  bodyFatPercentage: 22,
  notes: "Boa evolução",
  skinfolds: { triceps: 12 },
  client: { name: "Maria Silva", avatar: null },
};

describe("GenerateWorkoutPlanDto", () => {
  const valid = {
    clientName: "Maria Silva",
    goal: "Hipertrofia",
    experienceLevel: "Intermediário",
    daysPerWeek: 4,
  };

  it("accepts what the generator form sends", () => {
    expect(
      check(GenerateWorkoutPlanDto, {
        ...valid,
        limitations: "",
        customInstructions: "Seja direto.",
      }).invalid,
    ).toEqual([]);
  });

  it("rejects a 20k-character goal", () => {
    expect(
      check(GenerateWorkoutPlanDto, { ...valid, goal: "a".repeat(20_000) })
        .invalid,
    ).toEqual(["goal"]);
  });

  it.each([
    ["clientName", "a".repeat(201)],
    ["experienceLevel", "a".repeat(101)],
    ["limitations", "a".repeat(2001)],
    ["customInstructions", "a".repeat(10_001)],
    ["daysPerWeek", 8],
    ["daysPerWeek", 0],
    ["daysPerWeek", 2.5],
  ])("rejects %s out of bounds", (property, value) => {
    expect(
      check(GenerateWorkoutPlanDto, { ...valid, [property]: value }).invalid,
    ).toEqual([property]);
  });

  it("keeps only the client and evaluation fields the prompt uses", () => {
    const { dto, invalid } = check(GenerateWorkoutPlanDto, {
      ...valid,
      client: dashboardClient,
      latestEvaluation: dashboardEvaluation,
    });

    expect(invalid).toEqual([]);
    expect(JSON.parse(JSON.stringify(dto.client))).toEqual({
      name: "Maria Silva",
      goal: "Emagrecimento",
      notes: "Joelho direito sensível",
      dateOfBirth: "1990-05-20T00:00:00.000Z",
      medicalHistory: {
        objective: ["Saúde"],
        injuries: "Joelho",
        hasHeartDisease: false,
      },
    });
    expect(JSON.parse(JSON.stringify(dto.latestEvaluation))).toEqual({
      weight: 65,
      bodyFatPercentage: 22,
      notes: "Boa evolução",
    });
  });

  it.each([
    ["client", { name: "a".repeat(201) }],
    ["client", { name: "Maria", notes: "a".repeat(5001) }],
    ["client", { name: "Maria", dateOfBirth: "not a date" }],
    [
      "client",
      { name: "Maria", medicalHistory: { injuries: "a".repeat(5001) } },
    ],
    ["client", { name: "Maria", medicalHistory: { objective: "Saúde" } }],
    ["client", "Maria"],
    ["latestEvaluation", { weight: "heavy" }],
    ["latestEvaluation", { weight: 65, notes: "a".repeat(5001) }],
  ])("rejects an invalid %s: %j", (property, value) => {
    expect(
      check(GenerateWorkoutPlanDto, { ...valid, [property]: value }).invalid,
    ).toEqual([property]);
  });
});

describe("GenerateWorkoutInsightsDto", () => {
  const valid = { client: dashboardClient, archivedPlans: [] };

  it("accepts what the workout editor sends", () => {
    expect(
      check(GenerateWorkoutInsightsDto, {
        ...valid,
        latestEvaluation: dashboardEvaluation,
        archivedPlans: [
          {
            id: "w-1",
            title: "Treino A",
            description: "Membros inferiores",
            exercises: [{ name: "Agachamento", sets: 3, reps: "10" }],
            tags: ["Pernas"],
            createdAt: "2026-01-01",
          },
        ],
      }).invalid,
    ).toEqual([]);
  });

  it("keeps only title and description of the archived plans", () => {
    const { dto } = check(GenerateWorkoutInsightsDto, {
      ...valid,
      archivedPlans: [{ id: "w-1", title: "Treino A", exercises: [] }],
    });
    expect(JSON.parse(JSON.stringify(dto.archivedPlans))).toEqual([
      { title: "Treino A" },
    ]);
  });

  it("requires client and archivedPlans", () => {
    expect(check(GenerateWorkoutInsightsDto, {}).invalid.sort()).toEqual([
      "archivedPlans",
      "client",
    ]);
  });

  it("rejects more than 50 archived plans", () => {
    const archivedPlans = Array.from({ length: 51 }, () => ({ title: "T" }));
    expect(
      check(GenerateWorkoutInsightsDto, { ...valid, archivedPlans }).invalid,
    ).toEqual(["archivedPlans"]);
  });

  it.each([
    [[{ title: "a".repeat(201) }]],
    [[{ title: "T", description: "a".repeat(2001) }]],
    [["Treino A"]],
    ["Treino A"],
  ])("rejects archivedPlans %j", (archivedPlans) => {
    expect(
      check(GenerateWorkoutInsightsDto, { ...valid, archivedPlans }).invalid,
    ).toEqual(["archivedPlans"]);
  });

  it("rejects a 20k-character client goal and over-long instructions", () => {
    expect(
      check(GenerateWorkoutInsightsDto, {
        ...valid,
        client: { name: "Maria", goal: "a".repeat(20_000) },
      }).invalid,
    ).toEqual(["client"]);
    expect(
      check(GenerateWorkoutInsightsDto, {
        ...valid,
        customInstructions: "a".repeat(10_001),
      }).invalid,
    ).toEqual(["customInstructions"]);
  });
});
