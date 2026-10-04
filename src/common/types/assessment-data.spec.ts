import { BadRequestException } from "@nestjs/common";
import { AssessmentType } from "@prisma/client";
import {
  buildAnamnesisData,
  buildAssessmentData,
  buildPhysicalEvaluationData,
} from "./assessment-data";

describe("buildAnamnesisData", () => {
  it("wraps valid answers in the v1 envelope", () => {
    const data = buildAnamnesisData({
      fitnessGoals: "Hipertrofia",
      parqAnswers: { q1: false },
      weightKg: 72.5,
      measurements: { waist: 80 },
    });
    expect(data).toEqual({
      version: 1,
      fitnessGoals: "Hipertrofia",
      parqAnswers: { q1: false },
      weightKg: 72.5,
      measurements: { waist: 80 },
    });
  });

  it("accepts an empty form", () => {
    expect(buildAnamnesisData({})).toEqual({ version: 1 });
  });

  it("rejects unknown fields", () => {
    expect(() => buildAnamnesisData({ token: "abc" })).toThrow(
      BadRequestException,
    );
  });

  it("rejects a PAR-Q answer that is not a boolean", () => {
    expect(() => buildAnamnesisData({ parqAnswers: { q1: "yes" } })).toThrow(
      "Assessment.data.parqAnswers.q1 must be a boolean",
    );
  });

  it.each([0, -5, 0.4])(
    "rejects weightKg %p (regression: a weight-0 evaluation was created)",
    (weightKg) => {
      expect(() => buildAnamnesisData({ weightKg })).toThrow(
        BadRequestException,
      );
    },
  );

  it("accepts the minimum weight of 1 kg", () => {
    expect(buildAnamnesisData({ weightKg: 1 })).toEqual({
      version: 1,
      weightKg: 1,
    });
  });

  it("rejects a measurement that is not a number", () => {
    expect(() => buildAnamnesisData({ measurements: { waist: "80" } })).toThrow(
      "Assessment.data.measurements.waist must be a number",
    );
  });
});

describe("buildAnamnesisData bounds (review M2: token route)", () => {
  const manyKeys = (count: number, value: boolean | number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`q${i}`, value]),
    );

  it.each([
    "medicalHistory",
    "injuriesAndPain",
    "routineAndSchedule",
    "fitnessGoals",
  ])("rejects a %s longer than 5000 characters", (field) => {
    expect(() => buildAnamnesisData({ [field]: "a".repeat(5001) })).toThrow(
      BadRequestException,
    );
    expect(buildAnamnesisData({ [field]: "a".repeat(5000) })).toMatchObject({
      version: 1,
    });
  });

  it("rejects an experienceLevel longer than 200 characters", () => {
    expect(() =>
      buildAnamnesisData({ experienceLevel: "a".repeat(201) }),
    ).toThrow(BadRequestException);
  });

  it.each(["frontPhotoUrl", "backPhotoUrl", "sidePhotoUrl"])(
    "rejects a javascript: URL in %s",
    (field) => {
      expect(() =>
        buildAnamnesisData({ [field]: "javascript:alert(document.cookie)" }),
      ).toThrow(BadRequestException);
    },
  );

  it.each([
    "http://storage.googleapis.com/bucket/a.jpg",
    "//storage.googleapis.com/bucket/a.jpg",
    "storage.googleapis.com/bucket/a.jpg",
    "data:image/png;base64,AAAA",
    `https://storage.googleapis.com/${"a".repeat(2048)}`,
  ])("rejects the photo URL %s", (frontPhotoUrl) => {
    expect(() => buildAnamnesisData({ frontPhotoUrl })).toThrow(
      BadRequestException,
    );
  });

  it("accepts an https photo URL", () => {
    const frontPhotoUrl = "https://storage.googleapis.com/bucket/front.jpg";
    expect(buildAnamnesisData({ frontPhotoUrl })).toEqual({
      version: 1,
      frontPhotoUrl,
    });
  });

  it("rejects a 1,000-key parqAnswers", () => {
    expect(() =>
      buildAnamnesisData({ parqAnswers: manyKeys(1000, true) }),
    ).toThrow(BadRequestException);
  });

  it("accepts 50 PAR-Q answers and rejects 51", () => {
    expect(
      Object.keys(
        buildAnamnesisData({ parqAnswers: manyKeys(50, false) }).parqAnswers!,
      ),
    ).toHaveLength(50);
    expect(() =>
      buildAnamnesisData({ parqAnswers: manyKeys(51, false) }),
    ).toThrow(BadRequestException);
  });

  it("rejects a PAR-Q key longer than 64 characters", () => {
    expect(() =>
      buildAnamnesisData({ parqAnswers: { ["k".repeat(65)]: true } }),
    ).toThrow(BadRequestException);
  });

  it("rejects 51 measurements and a measurement outside 0-1000", () => {
    expect(() =>
      buildAnamnesisData({ measurements: manyKeys(51, 80) }),
    ).toThrow(BadRequestException);
    expect(() => buildAnamnesisData({ measurements: { waist: 1e9 } })).toThrow(
      BadRequestException,
    );
    expect(() => buildAnamnesisData({ measurements: { waist: -1 } })).toThrow(
      BadRequestException,
    );
  });

  it("rejects a weightKg above 500", () => {
    expect(() => buildAnamnesisData({ weightKg: 501 })).toThrow(
      BadRequestException,
    );
  });
});

describe("buildPhysicalEvaluationData", () => {
  it("wraps valid metrics in the v1 envelope", () => {
    const data = buildPhysicalEvaluationData({
      weight: 80,
      protocol: "POLLOCK_3",
      skinfolds: { triceps: 12 },
      perimeters: { waist: 85 },
    });
    expect(data).toMatchObject({
      version: 1,
      weight: 80,
      skinfolds: { triceps: 12 },
      perimeters: { waist: 85 },
    });
  });

  it("requires weight", () => {
    expect(() => buildPhysicalEvaluationData({ height: 1.8 })).toThrow(
      BadRequestException,
    );
  });

  it("bounds protocol, equation and notes (review M2)", () => {
    expect(() =>
      buildPhysicalEvaluationData({ weight: 80, notes: "a".repeat(5001) }),
    ).toThrow(BadRequestException);
    expect(() =>
      buildPhysicalEvaluationData({ weight: 80, protocol: "a".repeat(51) }),
    ).toThrow(BadRequestException);
    expect(() =>
      buildPhysicalEvaluationData({ weight: 80, equation: "a".repeat(51) }),
    ).toThrow(BadRequestException);
  });

  it("rejects unknown skinfold sites", () => {
    expect(() =>
      buildPhysicalEvaluationData({ weight: 80, skinfolds: { elbow: 3 } }),
    ).toThrow(BadRequestException);
  });
});

describe("buildAssessmentData", () => {
  it("dispatches on the assessment type", () => {
    expect(buildAssessmentData(AssessmentType.ANAMNESIS, {})).toEqual({
      version: 1,
    });
    expect(() =>
      buildAssessmentData(AssessmentType.PHYSICAL_EVALUATION, {}),
    ).toThrow(BadRequestException);
  });
});
