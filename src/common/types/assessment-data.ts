import { BadRequestException } from "@nestjs/common";
import { AssessmentType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { IsBoundedMap } from "./bounded-map.validator";
import { validateDocument } from "./json-validation";

/** `Assessment.data` when `type = ANAMNESIS`. A pending (not yet submitted) anamnesis stores `{ version: 1 }`. */
export interface AnamnesisData {
  version: typeof ASSESSMENT_DATA_VERSION;
  medicalHistory?: string;
  injuriesAndPain?: string;
  routineAndSchedule?: string;
  fitnessGoals?: string;
  experienceLevel?: string;
  /** PAR-Q question key -> answer. */
  parqAnswers?: Record<string, boolean>;
  frontPhotoUrl?: string;
  backPhotoUrl?: string;
  sidePhotoUrl?: string;
  weightKg?: number;
  /** Perimeter name -> cm. */
  measurements?: Record<string, number>;
}

/** `Assessment.data` when `type = PHYSICAL_EVALUATION` (the former Evaluation columns). */
export interface PhysicalEvaluationData {
  version: typeof ASSESSMENT_DATA_VERSION;
  /** kg */
  weight: number;
  /** m or cm, as entered by the trainer (unchanged from the Evaluation table). */
  height?: number;
  bodyFatPercentage?: number;
  leanMass?: number;
  fatMass?: number;
  bodyDensity?: number;
  /** "POLLOCK_3" | "POLLOCK_7" | "PETROSKI_4" | "DURNIN_WOMERSLEY_4" */
  protocol?: string;
  /** "SIRI" | "BROZEK" */
  equation?: string;
  notes?: string;
  perimeters?: Perimeters;
  skinfolds?: Skinfolds;
}

export type AssessmentData = AnamnesisData | PhysicalEvaluationData;

export const ASSESSMENT_DATA_VERSION = 1;
export const EMPTY_ANAMNESIS_DATA: AnamnesisData = {
  version: ASSESSMENT_DATA_VERSION,
};

/** Lowest `weightKg` an anamnesis may carry. */
export const MIN_ANAMNESIS_WEIGHT_KG = 1;

/** Highest `weightKg` / `weight` accepted (kg). */
export const MAX_WEIGHT_KG = 500;
/** Free-text answers and notes. */
export const ASSESSMENT_TEXT_MAX_LENGTH = 5000;
export const EXPERIENCE_LEVEL_MAX_LENGTH = 200;
export const PHOTO_URL_MAX_LENGTH = 2048;
/** Protocol and equation names ("DURNIN_WOMERSLEY_4" is the longest today). */
export const PROTOCOL_MAX_LENGTH = 50;
/** `parqAnswers` and `measurements`: key count, key length, numeric range (cm). */
export const ASSESSMENT_MAP_MAX_KEYS = 50;
export const ASSESSMENT_MAP_KEY_MAX_LENGTH = 64;
export const MAX_MEASUREMENT = 1000;
/** Upper bound of every perimeter (cm), skinfold (mm) and derived metric. */
export const MAX_METRIC = 1000;

const PHOTO_URL = { protocols: ["https"], require_protocol: true };
const ASSESSMENT_MAP = {
  maxKeys: ASSESSMENT_MAP_MAX_KEYS,
  maxKeyLength: ASSESSMENT_MAP_KEY_MAX_LENGTH,
  min: 0,
  max: MAX_MEASUREMENT,
};

/** Perimeters in cm. */
export class PerimetersDto {
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) waist?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) hip?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) chest?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) rightArm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) leftArm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) rightThigh?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) leftThigh?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) rightCalf?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) leftCalf?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) relaxedArm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) flexedArm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) forearm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) abdomen?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) thigh?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) calf?: number;
}
export type Perimeters = PerimetersDto;

/** Skinfolds in mm. */
export class SkinfoldsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) triceps?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) subscapular?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) suprailiac?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) abdominal?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) thigh?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) calf?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) chest?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) midaxillary?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) biceps?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) pectoral?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) axillary?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) supraSpinal?: number;
}
export type Skinfolds = SkinfoldsDto;

/** Fields of an anamnesis, without the version envelope. Reused by the submit DTO. */
export class AnamnesisAnswersDto {
  @IsOptional()
  @IsString()
  @MaxLength(ASSESSMENT_TEXT_MAX_LENGTH)
  medicalHistory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ASSESSMENT_TEXT_MAX_LENGTH)
  injuriesAndPain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ASSESSMENT_TEXT_MAX_LENGTH)
  routineAndSchedule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ASSESSMENT_TEXT_MAX_LENGTH)
  fitnessGoals?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EXPERIENCE_LEVEL_MAX_LENGTH)
  experienceLevel?: string;

  @IsOptional()
  @IsBoundedMap(ASSESSMENT_MAP)
  parqAnswers?: Record<string, boolean>;

  @IsOptional()
  @MaxLength(PHOTO_URL_MAX_LENGTH)
  @IsUrl(PHOTO_URL)
  frontPhotoUrl?: string;

  @IsOptional()
  @MaxLength(PHOTO_URL_MAX_LENGTH)
  @IsUrl(PHOTO_URL)
  backPhotoUrl?: string;

  @IsOptional()
  @MaxLength(PHOTO_URL_MAX_LENGTH)
  @IsUrl(PHOTO_URL)
  sidePhotoUrl?: string;

  /** kg. A submitted weight creates a physical evaluation, so 0 is not a weight. */
  @IsOptional()
  @IsNumber()
  @Min(MIN_ANAMNESIS_WEIGHT_KG)
  @Max(MAX_WEIGHT_KG)
  weightKg?: number;

  @IsOptional()
  @IsBoundedMap(ASSESSMENT_MAP)
  measurements?: Record<string, number>;
}

/** Fields of a physical evaluation, without the version envelope. Reused by the create/update DTOs. */
export class PhysicalEvaluationMetricsDto {
  @IsNumber() @Min(0) @Max(MAX_WEIGHT_KG) weight!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) height?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) bodyFatPercentage?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) leanMass?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) fatMass?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_METRIC) bodyDensity?: number;
  @IsOptional() @IsString() @MaxLength(PROTOCOL_MAX_LENGTH) protocol?: string;
  @IsOptional() @IsString() @MaxLength(PROTOCOL_MAX_LENGTH) equation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ASSESSMENT_TEXT_MAX_LENGTH)
  notes?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PerimetersDto)
  perimeters?: PerimetersDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SkinfoldsDto)
  skinfolds?: SkinfoldsDto;
}

function assertMapOf(
  map: Record<string, unknown> | undefined,
  kind: "boolean" | "number",
  label: string,
): void {
  const invalid = Object.entries(map ?? {}).find(([, v]) => typeof v !== kind);
  if (invalid) {
    throw new BadRequestException(`${label}.${invalid[0]} must be a ${kind}`);
  }
}

/**
 * Validates the answers of an anamnesis and wraps them in the stored envelope.
 *
 * @throws {BadRequestException} On unknown keys or wrong value types
 *
 * @example
 * const data = buildAnamnesisData({ fitnessGoals: "Hipertrofia", weightKg: 72 });
 */
export function buildAnamnesisData(answers: unknown): AnamnesisData {
  const valid = validateDocument(
    AnamnesisAnswersDto,
    answers,
    "Assessment.data",
  );
  assertMapOf(valid.parqAnswers, "boolean", "Assessment.data.parqAnswers");
  assertMapOf(valid.measurements, "number", "Assessment.data.measurements");
  return { version: ASSESSMENT_DATA_VERSION, ...valid };
}

/**
 * Validates the metrics of a physical evaluation and wraps them in the stored envelope.
 *
 * @throws {BadRequestException} When `weight` is missing or a metric is not a number
 *
 * @example
 * const data = buildPhysicalEvaluationData({ weight: 80, skinfolds: { triceps: 12 } });
 */
export function buildPhysicalEvaluationData(
  metrics: unknown,
): PhysicalEvaluationData {
  const valid = validateDocument(
    PhysicalEvaluationMetricsDto,
    metrics,
    "Assessment.data",
  );
  return { version: ASSESSMENT_DATA_VERSION, ...valid };
}

/**
 * Single entry point used before any write to `Assessment.data`.
 *
 * @param type - Discriminator stored in `Assessment.type`
 * @param payload - Answers or metrics, without `version`
 *
 * @example
 * const data = buildAssessmentData(AssessmentType.ANAMNESIS, dto);
 */
export function buildAssessmentData(
  type: AssessmentType,
  payload: unknown,
): AssessmentData {
  return type === AssessmentType.ANAMNESIS
    ? buildAnamnesisData(payload)
    : buildPhysicalEvaluationData(payload);
}
