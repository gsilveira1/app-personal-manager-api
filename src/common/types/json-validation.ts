import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validateSync, ValidationError } from "class-validator";

/** Flattens nested class-validator errors into "path: message" strings. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = "",
): string[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.values(error.constraints ?? {}).map(
      (message) => `${path}: ${message}`,
    );
    return [...own, ...flattenValidationErrors(error.children ?? [], path)];
  });
}

/**
 * Validates a plain object against a class-validator DTO before it is written to a
 * JSONB column. Unknown properties are rejected, so documents cannot grow silently.
 *
 * @param cls - DTO class describing the document
 * @param plain - Untrusted value
 * @param label - Name used in error messages, e.g. "User.settings"
 * @returns The validated instance
 * @throws {BadRequestException} When `plain` is not an object or violates the DTO
 *
 * @example
 * const dnd = validateDocument(DndConfigDto, body, "User.settings.dnd");
 */
export function validateDocument<T extends object>(
  cls: ClassConstructor<T>,
  plain: unknown,
  label: string,
): T {
  if (plain === null || typeof plain !== "object" || Array.isArray(plain)) {
    throw new BadRequestException(`${label} must be a JSON object`);
  }
  const instance = plainToInstance(cls, plain);
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new BadRequestException(
      flattenValidationErrors(errors, label),
      `${label} is invalid`,
    );
  }
  return instance;
}

/**
 * Converts a validated document into the value Prisma expects for a Json column
 * (drops `undefined` and class prototypes).
 *
 * @example
 * await prisma.user.update({ where: { id }, data: { settings: toJsonValue(settings) } });
 */
export function toJsonValue(document: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(document)) as Prisma.InputJsonValue;
}

/** True for non-null, non-array objects. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
