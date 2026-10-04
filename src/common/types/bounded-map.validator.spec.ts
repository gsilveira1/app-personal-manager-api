import { validateSync } from "class-validator";
import {
  describeBoundedMapViolation,
  IsBoundedMap,
} from "./bounded-map.validator";

const LIMITS = { maxKeys: 3, maxKeyLength: 5, min: 0, max: 100 };

describe("describeBoundedMapViolation", () => {
  it("accepts a map inside the limits", () => {
    expect(describeBoundedMapViolation({ a: 1, b: true }, LIMITS)).toBeNull();
    expect(describeBoundedMapViolation({}, LIMITS)).toBeNull();
  });

  it.each([[null], [[1, 2]], ["text"], [5]])(
    "rejects %p: not a plain object",
    (value) => {
      expect(describeBoundedMapViolation(value, LIMITS)).toMatch(/object/);
    },
  );

  it("rejects more keys than maxKeys", () => {
    expect(
      describeBoundedMapViolation({ a: 1, b: 1, c: 1, d: 1 }, LIMITS),
    ).toMatch(/at most 3 keys/);
  });

  it("rejects an empty key and a key longer than maxKeyLength", () => {
    expect(describeBoundedMapViolation({ "": 1 }, LIMITS)).toMatch(/1-5/);
    expect(describeBoundedMapViolation({ abcdef: 1 }, LIMITS)).toMatch(/1-5/);
  });

  it("rejects a number outside [min, max] and a non-finite number", () => {
    expect(describeBoundedMapViolation({ a: 101 }, LIMITS)).toMatch(/0.*100/);
    expect(describeBoundedMapViolation({ a: -1 }, LIMITS)).toMatch(/0.*100/);
    expect(describeBoundedMapViolation({ a: Infinity }, LIMITS)).toMatch(
      /0.*100/,
    );
  });

  it("rejects a string value longer than maxValueLength and nested values", () => {
    expect(
      describeBoundedMapViolation(
        { a: "toolong" },
        { ...LIMITS, maxValueLength: 3 },
      ),
    ).toMatch(/at most 3 characters/);
    expect(describeBoundedMapViolation({ a: { b: 1 } }, LIMITS)).toMatch(
      /boolean, number or string/,
    );
    expect(describeBoundedMapViolation({ a: [1] }, LIMITS)).toMatch(
      /boolean, number or string/,
    );
  });

  it("leaves value types to the caller: booleans and numbers both pass", () => {
    expect(describeBoundedMapViolation({ a: "yes" }, LIMITS)).toBeNull();
  });
});

describe("@IsBoundedMap", () => {
  class Holder {
    @IsBoundedMap(LIMITS)
    map!: unknown;
  }
  const errorsOf = (map: unknown) =>
    validateSync(Object.assign(new Holder(), { map }));

  it("passes a bounded map", () => {
    expect(errorsOf({ a: true })).toHaveLength(0);
  });

  it("reports the violation as the constraint message", () => {
    const [error] = errorsOf({ a: 1, b: 1, c: 1, d: 1 });
    expect(error.property).toBe("map");
    expect(Object.values(error.constraints ?? {})[0]).toMatch(
      /map must have at most 3 keys/,
    );
  });
});
