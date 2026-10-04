import { Type } from "class-transformer";
import {
  registerDecorator,
  ValidationOptions,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export const HEATMAP_DEFAULT_DAYS = 30;
export const HEATMAP_MAX_DAYS = 365;

/** 24 h. Also keeps the value far inside the int4 column. */
export const MAX_SESSION_DURATION_SECONDS = 86_400;
export const MAX_LOAD_KG = 2000;
/** A session may be reported late (offline PWA), but not from the future. */
export const COMPLETED_AT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const COMPLETED_AT_MAX_AGE_MS = 365 * 86_400_000;

/**
 * True when `value` is a date between one year ago and five minutes from now.
 *
 * @example
 * isWithinCompletionWindow(new Date().toISOString()) // true
 */
export function isWithinCompletionWindow(
  value: unknown,
  now: number = Date.now(),
): boolean {
  if (typeof value !== "string") return false;
  const at = Date.parse(value);
  return (
    !Number.isNaN(at) &&
    at <= now + COMPLETED_AT_MAX_FUTURE_SKEW_MS &&
    at >= now - COMPLETED_AT_MAX_AGE_MS
  );
}

function IsWithinCompletionWindow(
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: "isWithinCompletionWindow",
      target: target.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown) => isWithinCompletionWindow(value),
        defaultMessage: (args) =>
          `${args?.property} must be within the last year and not in the future`,
      },
    });
  };
}

export class ExerciseLoadDto {
  @IsString() @IsNotEmpty() @MaxLength(64) workoutExerciseId!: string;

  @IsOptional() @IsNumber() @Min(0) @Max(MAX_LOAD_KG) loadKg?: number;

  @IsOptional() @IsBoolean() completed?: boolean;
}

/** Body of `POST /student/sessions`. */
export class CompleteStudentSessionDto {
  /** A `WorkoutItem.id` of the student's active sheet. */
  @IsString() @IsNotEmpty() @MaxLength(64) workoutId!: string;

  @IsInt() @Min(0) @Max(MAX_SESSION_DURATION_SECONDS) durationSeconds!: number;

  @IsOptional()
  @IsDateString()
  @IsWithinCompletionWindow()
  completedAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ExerciseLoadDto)
  loads?: ExerciseLoadDto[];
}

/** Query of `GET /clients/:id/activity-heatmap`. */
export class ActivityHeatmapQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HEATMAP_MAX_DAYS)
  days?: number;
}

/** Contract 6.3: what the student PWA renders. */
export interface PortalSheet {
  sheetId: string | null;
  sheetName: string;
  trainerName?: string;
  trainerPhone?: string;
  workouts: PortalWorkout[];
}

export interface PortalWorkout {
  id: string;
  letter: string;
  name: string;
  blocks: Array<{
    id: string;
    type: string;
    restTimeSeconds: number;
    exercises: PortalExercise[];
  }>;
}

export interface PortalExercise {
  workoutExerciseId: string;
  exerciseName: string;
  gifUrl: string;
  sets: number;
  reps: string;
  executionNotes: string | null;
  lastLoadKg: number | null;
}

export interface MagicLink {
  token: string;
  url: string;
}

/** Contract 6.3: result of `POST /clients/:id/magic-link/send`. */
export interface SendLinkResult {
  status: "QUEUED";
  channel: "WHATSAPP";
  jobId: string;
  scheduledDelayMs: number;
  link: string;
  message: string;
}
