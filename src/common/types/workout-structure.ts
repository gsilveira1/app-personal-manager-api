import { randomUUID } from "crypto";
import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { isPlainObject } from "./json-validation";

/**
 * Document stored in `WorkoutSheet.structure` (JSONB). Replaces the WorkoutSheetItem,
 * WorkoutBlock and WorkoutExercise tables.
 *
 * Every item, block and exercise carries an `id` that is unique inside the sheet and
 * stable across edits. `Event.workoutSegmentId` points at a {@link WorkoutItem} id and
 * `StudentSession.executionData` points at item and exercise ids, so a client that edits
 * a sheet must send the ids back unchanged.
 */
export interface WorkoutSheetStructure {
  version: typeof WORKOUT_STRUCTURE_VERSION;
  /** Free text, used by templates (was WorkoutTemplate.description). */
  description?: string;
  /** Labels, used by templates. */
  tags?: string[];
  /** Workout divisions ("Treino A", "Treino B"...), ordered by `orderIndex`. */
  items: WorkoutItem[];
}

export interface WorkoutItem {
  id: string;
  /** "A", "B", "C"... */
  letter: string;
  name: string;
  orderIndex: number;
  blocks: WorkoutBlock[];
}

export interface WorkoutBlock {
  id: string;
  type: WorkoutBlockType;
  orderIndex: number;
  restTimeSeconds: number;
  exercises: WorkoutExerciseEntry[];
}

export interface WorkoutExerciseEntry {
  id: string;
  /** Exercise catalogue id; null for free-text exercises. Not a foreign key. */
  exerciseId: string | null;
  /** Snapshot of the exercise name at prescription time. */
  exerciseName: string;
  gifUrl: string | null;
  sets: number;
  /** "10-12", "15", "até a falha"... */
  reps: string;
  suggestedLoadKg: number | null;
  executionNotes: string | null;
  isWarmup: boolean;
  orderIndex: number;
}

export const WORKOUT_STRUCTURE_VERSION = 1;
export const WORKOUT_BLOCK_TYPES = ["REGULAR", "BISET", "TRISET"] as const;
export type WorkoutBlockType = (typeof WORKOUT_BLOCK_TYPES)[number];

const MIN_EXERCISES_BY_BLOCK: Record<WorkoutBlockType, number> = {
  REGULAR: 0,
  BISET: 2,
  TRISET: 3,
};
const SEGMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT_ID_MESSAGE = "id must be 1-64 chars of [A-Za-z0-9_-]";

/** Request shape of one prescribed exercise. `id` is optional: the server assigns a UUID when absent. */
export class WorkoutExerciseInputDto {
  @IsOptional()
  @Matches(SEGMENT_ID, { message: SEGMENT_ID_MESSAGE })
  id?: string;
  @IsOptional() @IsString() @MaxLength(64) exerciseId?: string;
  @IsOptional() @IsString() @MaxLength(200) exerciseName?: string;
  @IsOptional() @IsString() @MaxLength(2048) gifUrl?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) sets?: number;
  @IsOptional() @IsString() @MaxLength(50) reps?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(2000) suggestedLoadKg?: number;
  @IsOptional() @IsString() @MaxLength(2000) executionNotes?: string;
  @IsOptional() @IsBoolean() isWarmup?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) orderIndex?: number;
}

export class WorkoutBlockInputDto {
  @IsOptional()
  @Matches(SEGMENT_ID, { message: SEGMENT_ID_MESSAGE })
  id?: string;
  @IsIn(WORKOUT_BLOCK_TYPES) type!: WorkoutBlockType;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) orderIndex?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3600) restTimeSeconds?: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseInputDto)
  exercises!: WorkoutExerciseInputDto[];
}

export class WorkoutItemInputDto {
  @IsOptional()
  @Matches(SEGMENT_ID, { message: SEGMENT_ID_MESSAGE })
  id?: string;
  @IsString() @IsNotEmpty() @MaxLength(10) letter!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) orderIndex?: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WorkoutBlockInputDto)
  blocks!: WorkoutBlockInputDto[];
}

/** Body fragment shared by every endpoint that writes a sheet or a template. */
export class WorkoutStructureInputDto {
  @IsArray()
  @ArrayMaxSize(26)
  @ValidateNested({ each: true })
  @Type(() => WorkoutItemInputDto)
  workouts!: WorkoutItemInputDto[];

  @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];
}

export type IdFactory = () => string;

function buildExercise(
  input: WorkoutExerciseInputDto,
  index: number,
  newId: IdFactory,
): WorkoutExerciseEntry {
  return {
    id: input.id ?? newId(),
    exerciseId: input.exerciseId ?? null,
    exerciseName: input.exerciseName || "Exercício",
    gifUrl: input.gifUrl ?? null,
    sets: input.sets ?? 3,
    reps: input.reps ?? "10-12",
    suggestedLoadKg: input.suggestedLoadKg ?? null,
    executionNotes: input.executionNotes ?? null,
    isWarmup: input.isWarmup ?? false,
    orderIndex: input.orderIndex ?? index,
  };
}

function buildBlock(
  input: WorkoutBlockInputDto,
  index: number,
  itemLetter: string,
  newId: IdFactory,
): WorkoutBlock {
  const minimum = MIN_EXERCISES_BY_BLOCK[input.type];
  if (input.exercises.length < minimum) {
    throw new BadRequestException(
      `Bloco do tipo ${input.type} no treino ${itemLetter} deve ter no mínimo ${minimum} exercícios.`,
    );
  }
  return {
    id: input.id ?? newId(),
    type: input.type,
    orderIndex: input.orderIndex ?? index,
    restTimeSeconds: input.restTimeSeconds ?? 60,
    exercises: input.exercises.map((e, i) => buildExercise(e, i, newId)),
  };
}

function buildItem(
  input: WorkoutItemInputDto,
  index: number,
  newId: IdFactory,
): WorkoutItem {
  return {
    id: input.id ?? newId(),
    letter: input.letter,
    name: input.name,
    orderIndex: input.orderIndex ?? index,
    blocks: input.blocks.map((b, i) => buildBlock(b, i, input.letter, newId)),
  };
}

/** Every id in the document: items, blocks and exercises. */
export function listStructureIds(structure: WorkoutSheetStructure): string[] {
  return structure.items.flatMap((item) => [
    item.id,
    ...item.blocks.flatMap((block) => [
      block.id,
      ...block.exercises.map((exercise) => exercise.id),
    ]),
  ]);
}

function assertUniqueIds(structure: WorkoutSheetStructure): void {
  const seen = new Set<string>();
  for (const id of listStructureIds(structure)) {
    if (seen.has(id)) {
      throw new BadRequestException(
        `Duplicate id "${id}" in workout structure: ids must be unique within a sheet.`,
      );
    }
    seen.add(id);
  }
}

/**
 * Builds the JSONB document from an (already DTO-validated) request body: applies
 * defaults, assigns ids where the client sent none, and enforces the block rules.
 *
 * @param input - Validated request fragment
 * @param newId - Id generator, injectable for tests
 * @returns The document to store in `WorkoutSheet.structure`
 * @throws {BadRequestException} BISET with fewer than 2 or TRISET with fewer than 3 exercises; duplicate ids
 *
 * @example
 * const structure = buildWorkoutStructure(dto);
 * await prisma.workoutSheet.create({ data: { ..., structure: toJsonValue(structure) } });
 */
export function buildWorkoutStructure(
  input: WorkoutStructureInputDto,
  newId: IdFactory = randomUUID,
): WorkoutSheetStructure {
  const structure: WorkoutSheetStructure = {
    version: WORKOUT_STRUCTURE_VERSION,
    ...(input.description !== undefined && { description: input.description }),
    ...(input.tags !== undefined && { tags: input.tags }),
    items: input.workouts.map((item, index) => buildItem(item, index, newId)),
  };
  assertUniqueIds(structure);
  return structure;
}

/**
 * Reads a stored document. A document that does not have the expected envelope is a
 * data-integrity bug, so it fails loudly instead of rendering an empty sheet.
 *
 * @param stored - Raw value of `WorkoutSheet.structure`
 * @param sheetId - Used in the error message
 * @throws {InternalServerErrorException} When the stored value is not a v1 structure
 *
 * @example
 * const { items } = readWorkoutStructure(sheet.structure, sheet.id);
 */
export function readWorkoutStructure(
  stored: unknown,
  sheetId: string,
): WorkoutSheetStructure {
  if (
    !isPlainObject(stored) ||
    stored.version !== WORKOUT_STRUCTURE_VERSION ||
    !Array.isArray(stored.items)
  ) {
    throw new InternalServerErrorException(
      `WorkoutSheet ${sheetId} has a malformed structure document`,
    );
  }
  return stored as unknown as WorkoutSheetStructure;
}

/**
 * @returns The item with that id, or null (a dangling `Event.workoutSegmentId` is legal
 * after the sheet was edited)
 *
 * @example
 * findWorkoutItem(structure, event.workoutSegmentId)?.name
 */
export function findWorkoutItem(
  structure: WorkoutSheetStructure,
  itemId: string | null | undefined,
): WorkoutItem | null {
  if (!itemId) return null;
  return structure.items.find((item) => item.id === itemId) ?? null;
}
