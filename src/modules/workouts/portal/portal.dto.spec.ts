import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  ActivityHeatmapQueryDto,
  CompleteStudentSessionDto,
} from "./portal.dto";

const errorsOf = (cls: any, plain: object) =>
  validateSync(plainToInstance(cls, plain) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);

describe("CompleteStudentSessionDto", () => {
  const valid = { workoutId: "w-1", durationSeconds: 3000 };

  it("accepts the minimal body", () => {
    expect(errorsOf(CompleteStudentSessionDto, valid)).toEqual([]);
  });

  it("accepts loads without loadKg and with completed", () => {
    const body = {
      ...valid,
      completedAt: new Date(Date.now() - 3_600_000).toISOString(),
      loads: [
        { workoutExerciseId: "we-1", completed: false },
        { workoutExerciseId: "we-2", loadKg: 62.5 },
      ],
    };
    expect(errorsOf(CompleteStudentSessionDto, body)).toEqual([]);
  });

  it("regression: rejects a completedAt that is not a date (it used to reach Prisma as Invalid Date)", () => {
    expect(
      errorsOf(CompleteStudentSessionDto, { ...valid, completedAt: "ontem" }),
    ).toEqual(["completedAt"]);
  });

  it("rejects a missing workoutId, a negative duration and a negative load", () => {
    expect(
      errorsOf(CompleteStudentSessionDto, { durationSeconds: -1 }),
    ).toEqual(["workoutId", "durationSeconds"]);
    expect(
      errorsOf(CompleteStudentSessionDto, {
        ...valid,
        loads: [{ workoutExerciseId: "we-1", loadKg: -5 }],
      }),
    ).toEqual(["loads"]);
  });

  describe("bounds (review M2: token route)", () => {
    const at = (offsetMs: number) =>
      new Date(Date.now() + offsetMs).toISOString();
    const DAY = 86_400_000;

    it("rejects durationSeconds 2**31 (it overflowed int4 and answered 500)", () => {
      expect(
        errorsOf(CompleteStudentSessionDto, {
          ...valid,
          durationSeconds: 2 ** 31,
        }),
      ).toEqual(["durationSeconds"]);
    });

    it("accepts 24 h and rejects 24 h + 1 s", () => {
      expect(
        errorsOf(CompleteStudentSessionDto, {
          ...valid,
          durationSeconds: 86_400,
        }),
      ).toEqual([]);
      expect(
        errorsOf(CompleteStudentSessionDto, {
          ...valid,
          durationSeconds: 86_401,
        }),
      ).toEqual(["durationSeconds"]);
    });

    it("accepts a completedAt within the clock-skew allowance and up to a year old", () => {
      for (const completedAt of [at(60_000), at(-364 * DAY)]) {
        expect(
          errorsOf(CompleteStudentSessionDto, { ...valid, completedAt }),
        ).toEqual([]);
      }
    });

    it.each([
      ["one hour in the future", 3_600_000],
      ["two years old", -730 * DAY],
    ])("rejects a completedAt %s", (_label, offset) => {
      expect(
        errorsOf(CompleteStudentSessionDto, {
          ...valid,
          completedAt: at(offset),
        }),
      ).toEqual(["completedAt"]);
    });

    it("rejects a load above 2000 kg", () => {
      expect(
        errorsOf(CompleteStudentSessionDto, {
          ...valid,
          loads: [{ workoutExerciseId: "we-1", loadKg: 2001 }],
        }),
      ).toEqual(["loads"]);
    });
  });

  it("rejects unknown properties", () => {
    expect(
      errorsOf(CompleteStudentSessionDto, { ...valid, clientId: "x" }),
    ).toEqual(["clientId"]);
  });
});

describe("ActivityHeatmapQueryDto", () => {
  it("accepts no days and converts a numeric string", () => {
    expect(errorsOf(ActivityHeatmapQueryDto, {})).toEqual([]);
    expect(plainToInstance(ActivityHeatmapQueryDto, { days: "7" }).days).toBe(
      7,
    );
  });

  it.each(["abc", "0", "366", "1.5"])("rejects days=%s", (days) => {
    expect(errorsOf(ActivityHeatmapQueryDto, { days })).toEqual(["days"]);
  });
});
