/** Prisma error codes this module translates into HTTP answers. */
const UNIQUE_VIOLATION = "P2002";
const RECORD_NOT_FOUND = "P2025";

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

/** True when a write hit a unique constraint (e.g. `(email, userId)` on Client). */
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, UNIQUE_VIOLATION);
}

/** True when an `update`/`delete` matched no row. */
export function isRecordNotFound(error: unknown): boolean {
  return hasCode(error, RECORD_NOT_FOUND);
}
