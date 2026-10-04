import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

export enum SessionType {
  IN_PERSON = "In-Person",
  ONLINE = "Online",
}

export enum SessionCategory {
  WORKOUT = "Workout",
  CHECK_IN = "Check-in",
  EVALUATION = "Evaluation",
}

export const SESSION_TYPES = Object.values(SessionType);

/** Same pattern as the ids inside `WorkoutSheet.structure` (contract 5.2). */
const SEGMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RRULE_PREFIX = /^FREQ=/;

/** Runs the validators when the property is present, even when it is `null`. */
const isSent = (_object: unknown, value: unknown) => value !== undefined;

/**
 * Body of `POST /sessions`. Without `rrule` it creates a one-off session; with
 * `rrule` it creates a series whose DTSTART is `date`.
 */
export class CreateSessionDto {
  @IsDateString()
  date!: string;

  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @IsIn(SESSION_TYPES)
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  category!: string;

  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  workoutSheetId?: string;

  @IsOptional()
  @Matches(SEGMENT_ID, { message: "workoutSegmentId is not a valid item id" })
  workoutSegmentId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  /** Full RRULE value without the "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12". */
  @IsOptional()
  @IsString()
  @Matches(RRULE_PREFIX, { message: "rrule must start with FREQ=" })
  rrule?: string;

  /** TZID of the event; defaults to "America/Sao_Paulo". */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

/**
 * Body of `PATCH /sessions/:id`, for a one-off session or one occurrence of a series.
 * `workoutSheetId` / `workoutSegmentId` accept `null` to unlink the workout.
 */
export class UpdateSessionDto {
  @ValidateIf(isSent)
  @IsDateString()
  date?: string;

  @ValidateIf(isSent)
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @ValidateIf(isSent)
  @IsIn(SESSION_TYPES)
  type?: string;

  @ValidateIf(isSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @ValidateIf(isSent)
  @IsBoolean()
  completed?: boolean;

  @ValidateIf(isSent)
  @IsBoolean()
  cancelled?: boolean;

  @IsOptional()
  @IsUUID()
  workoutSheetId?: string | null;

  @IsOptional()
  @Matches(SEGMENT_ID, { message: "workoutSegmentId is not a valid item id" })
  workoutSegmentId?: string | null;
}
