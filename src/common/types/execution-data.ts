import { InternalServerErrorException } from "@nestjs/common";
import { isPlainObject } from "./json-validation";

/**
 * Document stored in `StudentSession.executionData` (JSONB): a snapshot of what the
 * student did, keyed by the ids of `WorkoutSheet.structure`.
 */
export interface ExecutionData {
  version: typeof EXECUTION_DATA_VERSION;
  /** Sheet the student executed; null when no sheet could be resolved. */
  sheetId: string | null;
  /** WorkoutItem.id inside that sheet (the old StudentSession.workoutId). */
  itemId: string | null;
  exercises: ExecutedExercise[];
}

export interface ExecutedExercise {
  /** WorkoutExerciseEntry.id inside the sheet structure. */
  workoutExerciseId: string;
  /** Load actually used; null when the student did not report one. */
  loadKg: number | null;
  /** Whether the student marked the exercise as done. */
  completed: boolean;
}

export const EXECUTION_DATA_VERSION = 1;

export interface ExecutionLoadInput {
  workoutExerciseId: string;
  loadKg?: number;
  completed?: boolean;
}

/**
 * Builds the document from the (already DTO-validated) portal request.
 *
 * @example
 * buildExecutionData({ sheetId, itemId: dto.workoutId, loads: dto.loads })
 */
export function buildExecutionData(input: {
  sheetId: string | null;
  itemId: string | null;
  loads?: ExecutionLoadInput[];
}): ExecutionData {
  return {
    version: EXECUTION_DATA_VERSION,
    sheetId: input.sheetId,
    itemId: input.itemId,
    exercises: (input.loads ?? []).map((load) => ({
      workoutExerciseId: load.workoutExerciseId,
      loadKg: load.loadKg ?? null,
      completed: load.completed ?? true,
    })),
  };
}

/**
 * @throws {InternalServerErrorException} When the stored value is not a v1 document
 *
 * @example
 * const data = readExecutionData(session.executionData, session.id);
 */
export function readExecutionData(
  stored: unknown,
  sessionId: string,
): ExecutionData {
  if (
    !isPlainObject(stored) ||
    stored.version !== EXECUTION_DATA_VERSION ||
    !Array.isArray(stored.exercises)
  ) {
    throw new InternalServerErrorException(
      `StudentSession ${sessionId} has a malformed executionData document`,
    );
  }
  return stored as unknown as ExecutionData;
}

/**
 * Loads reported in one session, by exercise id. Feeds `lastLoadKg` in the student portal.
 *
 * @example
 * loadsByExercise(lastSessionData).get(exercise.id) ?? exercise.suggestedLoadKg
 */
export function loadsByExercise(data: ExecutionData): Map<string, number> {
  const loads = new Map<string, number>();
  for (const exercise of data.exercises) {
    if (exercise.loadKg !== null) {
      loads.set(exercise.workoutExerciseId, exercise.loadKg);
    }
  }
  return loads;
}
