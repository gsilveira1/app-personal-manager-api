import { registerDecorator, ValidationOptions } from "class-validator";

/** Limits of a flat `key -> boolean | number | string` map coming from a client. */
export interface BoundedMapLimits {
  maxKeys: number;
  maxKeyLength: number;
  /** Inclusive range every numeric value must be in. */
  min?: number;
  max?: number;
  /** Maximum length of every string value. */
  maxValueLength?: number;
}

function describeValueViolation(
  key: string,
  value: unknown,
  limits: BoundedMapLimits,
): string | null {
  if (typeof value === "boolean") return null;
  if (typeof value === "number") {
    const min = limits.min ?? -Number.MAX_VALUE;
    const max = limits.max ?? Number.MAX_VALUE;
    return Number.isFinite(value) && value >= min && value <= max
      ? null
      : `value of "${key}" must be a number between ${min} and ${max}`;
  }
  if (typeof value === "string") {
    return limits.maxValueLength !== undefined &&
      value.length > limits.maxValueLength
      ? `value of "${key}" must have at most ${limits.maxValueLength} characters`
      : null;
  }
  return `value of "${key}" must be a boolean, number or string`;
}

/**
 * Checks the size of a flat map: key count, key length and the size of each value.
 * Which value TYPE the map holds is the caller's rule (see `assertMapOf`).
 *
 * @returns null when the map is inside the limits, otherwise what is wrong with it
 *
 * @example
 * describeBoundedMapViolation({ q1: true }, { maxKeys: 50, maxKeyLength: 64 }) // null
 */
export function describeBoundedMapViolation(
  value: unknown,
  limits: BoundedMapLimits,
): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "must be an object";
  }
  const entries = Object.entries(value);
  if (entries.length > limits.maxKeys) {
    return `must have at most ${limits.maxKeys} keys`;
  }
  for (const [key, entry] of entries) {
    if (key.length < 1 || key.length > limits.maxKeyLength) {
      return `keys must have 1-${limits.maxKeyLength} characters`;
    }
    const violation = describeValueViolation(key.slice(0, 64), entry, limits);
    if (violation) return violation;
  }
  return null;
}

/**
 * class-validator decorator over `describeBoundedMapViolation`.
 *
 * @example
 * @IsBoundedMap({ maxKeys: 50, maxKeyLength: 64 }) parqAnswers?: Record<string, boolean>;
 */
export function IsBoundedMap(
  limits: BoundedMapLimits,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: "isBoundedMap",
      target: target.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown) =>
          describeBoundedMapViolation(value, limits) === null,
        defaultMessage: (args) =>
          `${args?.property} ${describeBoundedMapViolation(args?.value, limits)}`,
      },
    });
  };
}
