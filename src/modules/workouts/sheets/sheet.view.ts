import { WorkoutSheet } from "@prisma/client";
import {
  readWorkoutStructure,
  WorkoutItem,
  WorkoutSheetStructure,
  WorkoutStructureInputDto,
} from "../../../common/types";

/** Contract 6.3: the one shape of client sheets and templates. */
export interface WorkoutSheetView {
  id: string;
  name: string;
  expiresAt: Date | null;
  active: boolean;
  isTemplate: boolean;
  clientId: string | null;
  userId: string;
  description: string | null;
  tags: string[];
  /** `structure.items`, sorted by `orderIndex` at every level. */
  workouts: WorkoutItem[];
  createdAt: Date;
  updatedAt: Date;
}

/** Contract 6.3: one sheet about to expire, with the client to contact. */
export interface ExpiringSheetView {
  client: { id: string; name: string; avatar: string | null; phone: string };
  sheet: { id: string; name: string; expiresAt: Date };
}

function byOrderIndex<T extends { orderIndex: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * @returns Items, blocks and exercises ordered by `orderIndex` (copies; the input is untouched)
 *
 * @example
 * sortWorkoutItems(readWorkoutStructure(sheet.structure, sheet.id).items)
 */
export function sortWorkoutItems(items: WorkoutItem[]): WorkoutItem[] {
  return byOrderIndex(items).map((item) => ({
    ...item,
    blocks: byOrderIndex(item.blocks).map((block) => ({
      ...block,
      exercises: byOrderIndex(block.exercises),
    })),
  }));
}

/**
 * @throws {InternalServerErrorException} When the stored structure is malformed
 *
 * @example
 * return toSheetView(await prisma.workoutSheet.create({ data }));
 */
export function toSheetView(sheet: WorkoutSheet): WorkoutSheetView {
  const { structure: stored, ...columns } = sheet;
  const structure = readWorkoutStructure(stored, sheet.id);
  return {
    ...columns,
    description: structure.description ?? null,
    tags: structure.tags ?? [],
    workouts: sortWorkoutItems(structure.items),
  };
}

/**
 * Turns a stored document back into builder input, ids included, so a partial edit or
 * a copy still goes through `buildWorkoutStructure` (contract section 5).
 *
 * @example
 * buildWorkoutStructure({ ...toStructureInput(current), tags: dto.tags })
 */
export function toStructureInput(
  structure: WorkoutSheetStructure,
): WorkoutStructureInputDto {
  return {
    description: structure.description,
    tags: structure.tags,
    workouts: structure.items.map((item) => ({
      ...item,
      blocks: item.blocks.map((block) => ({
        ...block,
        exercises: block.exercises.map((exercise) => ({
          ...exercise,
          exerciseId: exercise.exerciseId ?? undefined,
          gifUrl: exercise.gifUrl ?? undefined,
          suggestedLoadKg: exercise.suggestedLoadKg ?? undefined,
          executionNotes: exercise.executionNotes ?? undefined,
        })),
      })),
    })),
  };
}
