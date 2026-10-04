import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  buildWorkoutStructure,
  findWorkoutItem,
  listStructureIds,
  readWorkoutStructure,
  WorkoutStructureInputDto,
} from "./workout-structure";

const sequentialIds = () => {
  let next = 0;
  return () => `gen-${++next}`;
};

const input = (workouts: unknown[]): WorkoutStructureInputDto =>
  plainToInstance(WorkoutStructureInputDto, { workouts });

const regularBlock = (exercises: unknown[] = [{ exerciseName: "Supino" }]) => ({
  type: "REGULAR",
  exercises,
});

describe("buildWorkoutStructure", () => {
  it("assigns ids and defaults where the client sent none", () => {
    const structure = buildWorkoutStructure(
      input([{ letter: "A", name: "Peito", blocks: [regularBlock()] }]),
      sequentialIds(),
    );

    expect(structure).toEqual({
      version: 1,
      items: [
        {
          id: "gen-1",
          letter: "A",
          name: "Peito",
          orderIndex: 0,
          blocks: [
            {
              id: "gen-2",
              type: "REGULAR",
              orderIndex: 0,
              restTimeSeconds: 60,
              exercises: [
                {
                  id: "gen-3",
                  exerciseId: null,
                  exerciseName: "Supino",
                  gifUrl: null,
                  sets: 3,
                  reps: "10-12",
                  suggestedLoadKg: null,
                  executionNotes: null,
                  isWarmup: false,
                  orderIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("keeps the ids sent by the client", () => {
    const structure = buildWorkoutStructure(
      input([
        {
          id: "treino-a",
          letter: "A",
          name: "Peito",
          blocks: [{ id: "b1", ...regularBlock([{ id: "e1" }]) }],
        },
      ]),
    );
    expect(listStructureIds(structure)).toEqual(["treino-a", "b1", "e1"]);
  });

  it("stores description and tags only when given", () => {
    const dto = plainToInstance(WorkoutStructureInputDto, {
      workouts: [],
      description: "Base",
      tags: ["força"],
    });
    expect(buildWorkoutStructure(dto)).toEqual({
      version: 1,
      description: "Base",
      tags: ["força"],
      items: [],
    });
  });

  it.each([
    ["BISET", 1, 2],
    ["TRISET", 2, 3],
  ])("rejects a %s block with %i exercises", (type, count, minimum) => {
    const exercises = Array.from({ length: count }, () => ({}));
    expect(() =>
      buildWorkoutStructure(
        input([{ letter: "B", name: "Costas", blocks: [{ type, exercises }] }]),
      ),
    ).toThrow(
      `Bloco do tipo ${type} no treino B deve ter no mínimo ${minimum} exercícios.`,
    );
  });

  it("rejects duplicate ids anywhere in the sheet", () => {
    expect(() =>
      buildWorkoutStructure(
        input([
          { id: "x", letter: "A", name: "A", blocks: [] },
          { letter: "B", name: "B", blocks: [{ id: "x", ...regularBlock() }] },
        ]),
      ),
    ).toThrow(BadRequestException);
  });
});

describe("WorkoutStructureInputDto", () => {
  const errorsOf = (plain: unknown) =>
    validateSync(plainToInstance(WorkoutStructureInputDto, plain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it("accepts the body the client sends today (no ids)", () => {
    const body = {
      workouts: [
        { letter: "A", name: "Peito", orderIndex: 0, blocks: [regularBlock()] },
      ],
    };
    expect(errorsOf(body)).toHaveLength(0);
  });

  it("rejects an unknown block type", () => {
    const body = {
      workouts: [
        { letter: "A", name: "x", blocks: [{ type: "GIANT", exercises: [] }] },
      ],
    };
    expect(errorsOf(body)).not.toHaveLength(0);
  });

  it("rejects ids with characters outside [A-Za-z0-9_-]", () => {
    const body = {
      workouts: [{ id: "a b", letter: "A", name: "x", blocks: [] }],
    };
    expect(errorsOf(body)).not.toHaveLength(0);
  });
});

describe("readWorkoutStructure", () => {
  it("returns a stored v1 document", () => {
    const stored = { version: 1, items: [] };
    expect(readWorkoutStructure(stored, "sheet-1")).toBe(stored);
  });

  it.each([null, {}, { version: 2, items: [] }, { version: 1 }, []])(
    "fails loudly on malformed document %p",
    (stored) => {
      expect(() => readWorkoutStructure(stored, "sheet-1")).toThrow(
        InternalServerErrorException,
      );
    },
  );
});

describe("findWorkoutItem", () => {
  const structure = buildWorkoutStructure(
    input([{ id: "treino-a", letter: "A", name: "Peito", blocks: [] }]),
  );

  it("finds an item by id", () => {
    expect(findWorkoutItem(structure, "treino-a")?.name).toBe("Peito");
  });

  it.each([null, undefined, "", "gone"])("returns null for %p", (id) => {
    expect(findWorkoutItem(structure, id)).toBeNull();
  });
});
