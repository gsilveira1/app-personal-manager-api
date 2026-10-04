import { ClientModality, ClientStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";

import {
  normalizeEmail,
  parseClientModality,
  parseClientStatus,
} from "../client-parsing";

export const NAME_MAX_LENGTH = 200;
/** RFC 5321 maximum length of an e-mail address. */
export const EMAIL_MAX_LENGTH = 254;
export const PHONE_MAX_LENGTH = 32;
export const GOAL_MAX_LENGTH = 2000;
/** Free-text notes and medical-history answers. */
export const LONG_TEXT_MAX_LENGTH = 5000;
export const SHORT_LABEL_MAX_LENGTH = 50;
export const MAX_OBJECTIVES = 20;
export const OBJECTIVE_MAX_LENGTH = 100;

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Shape of the `Client.medicalHistory` JSON column (unchanged). */
export class MedicalHistoryDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OBJECTIVES)
  @IsString({ each: true })
  @MaxLength(OBJECTIVE_MAX_LENGTH, { each: true })
  objective?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  injuries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  surgeries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  medications?: string;

  @IsOptional()
  @IsBoolean()
  hasHeartDisease?: boolean;

  @IsOptional()
  @IsBoolean()
  smoker?: boolean;

  @IsOptional()
  @IsBoolean()
  drinker?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  observations?: string;
}

/**
 * Body of `POST /clients`. The class has no property initialisers on purpose:
 * `PartialType` copies them, and a default here would overwrite the stored value on
 * every PATCH. Defaults are applied by the service on create.
 */
export class CreateClientDto {
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @MaxLength(PHONE_MAX_LENGTH)
  phone!: string;

  /** Enum value, case-insensitive, or a synonym (ATIVO, PAUSADA, EM ATRASO...). */
  @IsOptional()
  @Transform(({ value }) =>
    isBlank(value) ? undefined : (parseClientStatus(value) ?? value),
  )
  @IsEnum(ClientStatus)
  status?: ClientStatus;

  @IsOptional()
  @Transform(({ value }) =>
    isBlank(value) ? undefined : (parseClientModality(value) ?? value),
  )
  @IsEnum(ClientModality)
  modality?: ClientModality;

  @IsString()
  @IsOptional()
  @MaxLength(GOAL_MAX_LENGTH)
  goal?: string;

  /**
   * No MaxLength on purpose: outside production the dashboard falls back to a
   * base64 data URL when the GCS upload fails, so the bound is the body limit
   * of the route (`bodyLimitFor` in app.setup.ts: 100 kb in production).
   */
  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsOptional()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  notes?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (isBlank(value)) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  })
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @Transform(({ value }) => (isBlank(value) ? undefined : value))
  @IsString()
  @MaxLength(SHORT_LABEL_MAX_LENGTH)
  checkInFreq?: string;

  /** Alias of `checkInFreq` sent by the client app; wins when both are present. */
  @IsOptional()
  @Transform(({ value }) => (isBlank(value) ? undefined : value))
  @IsString()
  @MaxLength(SHORT_LABEL_MAX_LENGTH)
  checkInFrequency?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MedicalHistoryDto)
  medicalHistory?: MedicalHistoryDto;

  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @IsUUID()
  planId?: string;

  @IsBoolean()
  @IsOptional()
  notificationEnabled?: boolean;
}
