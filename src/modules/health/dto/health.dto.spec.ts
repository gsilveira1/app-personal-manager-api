import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateEvaluationDto, UpdateEvaluationDto } from "./evaluation.dto";
import { SubmitAnamnesisDto } from "./submit-anamnesis.dto";

const PIPE = { whitelist: true, forbidNonWhitelisted: true };
const CLIENT_ID = "3f0c1f0e-8f2b-4a57-9d3b-1f1f2a3b4c5d";

function errorsOf<T extends object>(cls: new () => T, plain: object): string[] {
  return validateSync(plainToInstance(cls, plain), PIPE).map((e) => e.property);
}

describe("CreateEvaluationDto", () => {
  it("accepts client, date and metrics", () => {
    const body = {
      clientId: CLIENT_ID,
      date: "2026-10-03",
      weight: 65,
      perimeters: { waist: 75 },
      skinfolds: { triceps: 12 },
    };
    expect(errorsOf(CreateEvaluationDto, body)).toEqual([]);
  });

  it("requires clientId (uuid), date and weight", () => {
    expect(errorsOf(CreateEvaluationDto, { clientId: "abc" }).sort()).toEqual([
      "clientId",
      "date",
      "weight",
    ]);
  });

  it("rejects an unknown perimeter key", () => {
    const body = {
      clientId: CLIENT_ID,
      date: "2026-10-03",
      weight: 65,
      perimeters: { neck: 40 },
    };
    expect(errorsOf(CreateEvaluationDto, body)).toEqual(["perimeters"]);
  });
});

describe("UpdateEvaluationDto", () => {
  it("accepts a partial body", () => {
    expect(errorsOf(UpdateEvaluationDto, { weight: 64 })).toEqual([]);
    expect(errorsOf(UpdateEvaluationDto, {})).toEqual([]);
  });

  it("rejects clientId: an evaluation cannot change client", () => {
    expect(errorsOf(UpdateEvaluationDto, { clientId: CLIENT_ID })).toEqual([
      "clientId",
    ]);
  });
});

describe("SubmitAnamnesisDto", () => {
  it("accepts the token with answers", () => {
    const body = { token: "abc", fitnessGoals: "Hipertrofia", weightKg: 70 };
    expect(errorsOf(SubmitAnamnesisDto, body)).toEqual([]);
  });

  it("requires a non-empty token", () => {
    expect(errorsOf(SubmitAnamnesisDto, {})).toEqual(["token"]);
    expect(errorsOf(SubmitAnamnesisDto, { token: "" })).toEqual(["token"]);
  });

  it("rejects unknown properties", () => {
    expect(
      errorsOf(SubmitAnamnesisDto, { token: "abc", isCurrent: true }),
    ).toEqual(["isCurrent"]);
  });

  it("rejects a javascript: photo URL (review M2)", () => {
    expect(
      errorsOf(SubmitAnamnesisDto, {
        token: "abc",
        frontPhotoUrl: "javascript:alert(1)",
      }),
    ).toEqual(["frontPhotoUrl"]);
  });

  it("rejects a 1,000-key parqAnswers (review M2)", () => {
    const parqAnswers = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`q${i}`, true]),
    );
    expect(errorsOf(SubmitAnamnesisDto, { token: "abc", parqAnswers })).toEqual(
      ["parqAnswers"],
    );
  });

  it("rejects a 5001-character free-text answer (review M2)", () => {
    expect(
      errorsOf(SubmitAnamnesisDto, {
        token: "abc",
        medicalHistory: "a".repeat(5001),
      }),
    ).toEqual(["medicalHistory"]);
  });
});
