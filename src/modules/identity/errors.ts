import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const UNIQUE_VIOLATION = "P2002";
export const RECORD_NOT_FOUND = "P2025";

/** True when `error` is a Prisma request error with the given code. */
export function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function toFieldList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

/**
 * Columns behind a unique violation. The query engine reports them in `meta.target`;
 * driver adapters (adapter-pg) report them in `meta.driverAdapterError.cause.constraint`.
 *
 * @returns The column names (or the constraint name), empty when Prisma did not say
 *
 * @example
 * if (uniqueViolationFields(error).some((f) => f.includes("slug"))) { ... }
 */
export function uniqueViolationFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = (error.meta ?? {}) as Record<string, any>;
  const constraint = meta.driverAdapterError?.cause?.constraint;
  return [
    ...toFieldList(meta.target),
    ...toFieldList(constraint?.fields),
    ...toFieldList(constraint?.index),
  ];
}

/** True when the unique violation is known to involve `field`. */
export function violatesUnique(
  error: Prisma.PrismaClientKnownRequestError,
  field: string,
): boolean {
  return uniqueViolationFields(error).some((name) => name.includes(field));
}

/** The 404 every identity service answers for a missing account. */
export function userNotFound(userId: string): NotFoundException {
  return new NotFoundException(`Usuário #${userId} não encontrado`);
}
