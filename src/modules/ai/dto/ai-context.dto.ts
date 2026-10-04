import {
  ClassConstructor,
  plainToInstance,
  Transform,
} from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/** Limits of everything that is interpolated into a prompt. */
export const AI_NAME_MAX_LENGTH = 200;
export const AI_GOAL_MAX_LENGTH = 2000;
export const AI_TEXT_MAX_LENGTH = 5000;
export const AI_INSTRUCTIONS_MAX_LENGTH = 10_000;
export const AI_MAX_OBJECTIVES = 20;
export const AI_OBJECTIVE_MAX_LENGTH = 100;
export const AI_MAX_ARCHIVED_PLANS = 50;
export const AI_PLAN_DESCRIPTION_MAX_LENGTH = 2000;
export const AI_MAX_WEIGHT_KG = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The dashboard sends whole views (a Client with its plan, an Evaluation with its
 * skinfolds...). The prompt uses a handful of fields, so only those are kept and
 * validated; everything else is dropped before validation instead of being
 * forwarded or refused. A value that is not an object is left as it is, so
 * `@ValidateNested` refuses it.
 */
function pickInto<T extends object>(
  cls: ClassConstructor<T>,
  keys: readonly (keyof T & string)[],
  value: unknown,
): unknown {
  if (!isRecord(value)) return value;
  const picked = Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined && value[key] !== null)
      .map((key) => [key, value[key]]),
  );
  return plainToInstance(cls, picked);
}

/**
 * Property decorator: keeps `keys` of a nested object (or of every element of an
 * array) and turns it into `cls`.
 *
 * @example
 * @PickNested(() => AiClientDto, ["name", "goal"]) client?: AiClientDto;
 */
export function PickNested<T extends object>(
  cls: () => ClassConstructor<T>,
  keys: readonly (keyof T & string)[],
): PropertyDecorator {
  // Reads the raw source (`obj[key]`), not `value`: with the global pipe's
  // enableImplicitConversion the nested value has already been coerced to the
  // reflected property type (array elements become `[]`).
  return Transform(({ obj, key }) => {
    const raw: unknown = (obj as Record<string, unknown>)[key];
    return Array.isArray(raw)
      ? raw.map((item) => pickInto(cls(), keys, item))
      : pickInto(cls(), keys, raw);
  });
}

export class AiMedicalHistoryDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_MAX_OBJECTIVES)
  @IsString({ each: true })
  @MaxLength(AI_OBJECTIVE_MAX_LENGTH, { each: true })
  objective?: string[];

  @IsOptional() @IsString() @MaxLength(AI_TEXT_MAX_LENGTH) injuries?: string;
  @IsOptional() @IsString() @MaxLength(AI_TEXT_MAX_LENGTH) surgeries?: string;
  @IsOptional() @IsString() @MaxLength(AI_TEXT_MAX_LENGTH) medications?: string;
  @IsOptional() @IsBoolean() hasHeartDisease?: boolean;
  @IsOptional() @IsBoolean() smoker?: boolean;
  @IsOptional() @IsBoolean() drinker?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(AI_TEXT_MAX_LENGTH)
  observations?: string;
}

const MEDICAL_HISTORY_KEYS = [
  "objective",
  "injuries",
  "surgeries",
  "medications",
  "hasHeartDisease",
  "smoker",
  "drinker",
  "observations",
] as const;

/** The client fields the prompts use. */
export class AiClientDto {
  @IsOptional() @IsString() @MaxLength(AI_NAME_MAX_LENGTH) name?: string;
  @IsOptional() @IsString() @MaxLength(AI_GOAL_MAX_LENGTH) goal?: string;
  @IsOptional() @IsString() @MaxLength(AI_TEXT_MAX_LENGTH) notes?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;

  @IsOptional()
  @PickNested(() => AiMedicalHistoryDto, MEDICAL_HISTORY_KEYS)
  @ValidateNested()
  medicalHistory?: AiMedicalHistoryDto;
}

export const AI_CLIENT_KEYS = [
  "name",
  "goal",
  "notes",
  "dateOfBirth",
  "medicalHistory",
] as const;

/** The evaluation fields the prompts use. */
export class AiEvaluationDto {
  @IsOptional() @IsNumber() @Min(0) @Max(AI_MAX_WEIGHT_KG) weight?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) bodyFatPercentage?: number;
  @IsOptional() @IsString() @MaxLength(AI_TEXT_MAX_LENGTH) notes?: string;
}

export const AI_EVALUATION_KEYS = [
  "weight",
  "bodyFatPercentage",
  "notes",
] as const;

/** The archived-plan fields the insights prompt uses. */
export class AiArchivedPlanDto {
  @IsOptional() @IsString() @MaxLength(AI_NAME_MAX_LENGTH) title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_PLAN_DESCRIPTION_MAX_LENGTH)
  description?: string;
}

export const AI_ARCHIVED_PLAN_KEYS = ["title", "description"] as const;
