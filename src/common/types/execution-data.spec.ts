import { InternalServerErrorException } from "@nestjs/common";
import {
  buildExecutionData,
  loadsByExercise,
  readExecutionData,
} from "./execution-data";

describe("buildExecutionData", () => {
  it("builds a v1 document from the portal payload", () => {
    const data = buildExecutionData({
      sheetId: "sheet-1",
      itemId: "treino-a",
      loads: [
        { workoutExerciseId: "e1", loadKg: 40 },
        { workoutExerciseId: "e2", completed: false },
      ],
    });
    expect(data).toEqual({
      version: 1,
      sheetId: "sheet-1",
      itemId: "treino-a",
      exercises: [
        { workoutExerciseId: "e1", loadKg: 40, completed: true },
        { workoutExerciseId: "e2", loadKg: null, completed: false },
      ],
    });
  });

  it("stores an empty list when no loads were reported", () => {
    expect(
      buildExecutionData({ sheetId: null, itemId: null }).exercises,
    ).toEqual([]);
  });
});

describe("readExecutionData", () => {
  it("returns a stored v1 document", () => {
    const stored = { version: 1, sheetId: null, itemId: null, exercises: [] };
    expect(readExecutionData(stored, "s1")).toBe(stored);
  });

  it.each([null, [], { version: 1 }, { version: 9, exercises: [] }])(
    "fails loudly on malformed document %p",
    (stored) => {
      expect(() => readExecutionData(stored, "s1")).toThrow(
        InternalServerErrorException,
      );
    },
  );
});

describe("loadsByExercise", () => {
  it("maps exercise ids to reported loads and skips unreported ones", () => {
    const data = buildExecutionData({
      sheetId: "s",
      itemId: "i",
      loads: [
        { workoutExerciseId: "e1", loadKg: 0 },
        { workoutExerciseId: "e2" },
      ],
    });
    expect([...loadsByExercise(data)]).toEqual([["e1", 0]]);
  });
});
