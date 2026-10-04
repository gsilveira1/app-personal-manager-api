import { InternalServerErrorException, Logger } from "@nestjs/common";
import { Assessment, AssessmentType } from "@prisma/client";
import {
  anamnesisStatus,
  readAnamnesisData,
  readPhysicalEvaluationData,
  toAnamnesisViews,
  toEvaluationView,
} from "./assessment.views";

const NOW = new Date("2026-10-03T12:00:00Z");

function row(overrides: Partial<Assessment>): Assessment {
  return {
    id: "a-1",
    type: AssessmentType.ANAMNESIS,
    data: { version: 1 },
    date: new Date("2026-10-01T00:00:00Z"),
    magicToken: null,
    tokenExpiresAt: null,
    clientId: "client-1",
    userId: "user-1",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

describe("anamnesisStatus", () => {
  it("is SUBMITTED when the token was cleared", () => {
    expect(anamnesisStatus(row({}), NOW)).toBe("SUBMITTED");
  });

  it("is EXPIRED when the token is still set and its expiry is in the past", () => {
    const expired = row({
      magicToken: "t",
      tokenExpiresAt: new Date("2026-10-03T11:59:59Z"),
    });
    expect(anamnesisStatus(expired, NOW)).toBe("EXPIRED");
  });

  it("is PENDING when the token is set and not expired", () => {
    const pending = row({
      magicToken: "t",
      tokenExpiresAt: new Date("2026-10-04T00:00:00Z"),
    });
    expect(anamnesisStatus(pending, NOW)).toBe("PENDING");
  });
});

describe("toAnamnesisViews", () => {
  it("flattens the answers and never exposes the token", () => {
    const [view] = toAnamnesisViews(
      [
        row({
          data: { version: 1, fitnessGoals: "Hipertrofia", weightKg: 70 },
        }),
      ],
      NOW,
    );
    expect(view).toEqual({
      id: "a-1",
      clientId: "client-1",
      status: "SUBMITTED",
      isCurrent: true,
      tokenUsed: true,
      date: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date("2026-10-01T00:00:00Z"),
      fitnessGoals: "Hipertrofia",
      weightKg: 70,
    });
    expect(view).not.toHaveProperty("magicToken");
    expect(view).not.toHaveProperty("version");
  });

  it("derives isCurrent: only the submitted row with the latest date", () => {
    const views = toAnamnesisViews(
      [
        row({
          id: "pending-newest",
          magicToken: "t",
          tokenExpiresAt: new Date("2026-10-09T00:00:00Z"),
          date: new Date("2026-10-03T00:00:00Z"),
        }),
        row({ id: "old", date: new Date("2026-08-01T00:00:00Z") }),
        row({ id: "latest", date: new Date("2026-09-15T00:00:00Z") }),
      ],
      NOW,
    );
    expect(views.map((v) => [v.id, v.isCurrent, v.status])).toEqual([
      ["pending-newest", false, "PENDING"],
      ["old", false, "SUBMITTED"],
      ["latest", true, "SUBMITTED"],
    ]);
  });

  it("marks nothing as current when no anamnesis was submitted", () => {
    const views = toAnamnesisViews(
      [row({ magicToken: "t", tokenExpiresAt: new Date("2020-01-01") })],
      NOW,
    );
    expect(views[0]).toMatchObject({
      isCurrent: false,
      tokenUsed: false,
      status: "EXPIRED",
    });
  });
});

describe("toEvaluationView", () => {
  it("flattens data and keeps the client display projection", () => {
    const view = toEvaluationView({
      ...row({
        type: AssessmentType.PHYSICAL_EVALUATION,
        data: { version: 1, weight: 65, perimeters: { waist: 75 } },
      }),
      client: { name: "Maria", avatar: null },
    });
    expect(view).toEqual({
      id: "a-1",
      clientId: "client-1",
      date: new Date("2026-10-01T00:00:00Z"),
      weight: 65,
      perimeters: { waist: 75 },
      client: { name: "Maria", avatar: null },
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    });
  });
});

describe("read*Data", () => {
  let logged: jest.SpyInstance;

  beforeEach(() => {
    logged = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("logs the assessment id of the malformed document", () => {
    expect(() => readAnamnesisData([], "a-9")).toThrow(
      InternalServerErrorException,
    );
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("assessmentId=a-9"),
    );
  });

  it("throws 500 on a document without the version envelope", () => {
    expect(() => readAnamnesisData({}, "a-1")).toThrow(
      InternalServerErrorException,
    );
    expect(() => readAnamnesisData(null, "a-1")).toThrow(
      InternalServerErrorException,
    );
  });

  it("throws 500 on an evaluation without a numeric weight", () => {
    expect(() => readPhysicalEvaluationData({ version: 1 }, "a-1")).toThrow(
      InternalServerErrorException,
    );
  });
});
