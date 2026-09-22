import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsDateString,
  IsObject,
  ValidateNested,
  IsArray,
  IsBoolean,
  IsUUID,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { ClientStatus, ClientModality } from "@prisma/client";

// DTO para validar o objeto JSON de histórico médico
export class MedicalHistoryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  objective?: string[] = [];

  @IsOptional()
  @IsString()
  injuries?: string;

  @IsOptional()
  @IsString()
  surgeries?: string;

  @IsOptional()
  @IsString()
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
  observations?: string;
}

export class CreateClientDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @IsEnum(ClientStatus)
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw =
      obj?.subscriptionStatus !== undefined
        ? obj.subscriptionStatus
        : (value ?? obj?.status);
    if (raw === undefined || raw === null || raw === "")
      return ClientStatus.ACTIVE;
    const s = String(raw).toUpperCase().trim();
    if (s === "ACTIVE" || s === "ATIVO") return ClientStatus.ACTIVE;
    if (s === "PAUSED" || s === "PAUSADA" || s === "PAUSADO")
      return ClientStatus.PAUSED;
    if (
      s === "OVERDUE" ||
      s === "EM ATRASO" ||
      s === "EM_ATRASO" ||
      s === "INACTIVE"
    )
      return ClientStatus.OVERDUE;
    if (s === "LEAD") return ClientStatus.LEAD;
    return raw;
  })
  status?: ClientStatus = ClientStatus.ACTIVE;

  @IsEnum(ClientModality)
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = obj?.type !== undefined ? obj.type : (value ?? obj?.modality);
    if (raw === undefined || raw === null || raw === "")
      return ClientModality.PRESENCIAL;
    const m = String(raw).toUpperCase().trim();
    if (m === "PRESENCIAL" || m === "IN-PERSON" || m === "IN_PERSON")
      return ClientModality.PRESENCIAL;
    if (m === "ONLINE") return ClientModality.ONLINE;
    if (m === "HYBRID" || m === "HÍBRIDO" || m === "HIBRIDO")
      return ClientModality.HYBRID;
    return raw;
  })
  modality?: ClientModality = ClientModality.PRESENCIAL;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  @Transform(({ value }) => {
    if (!value || value === "") return undefined;
    try {
      return new Date(value).toISOString();
    } catch {
      return value;
    }
  })
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw =
      obj?.checkInFrequency !== undefined
        ? obj.checkInFrequency
        : (value ?? obj?.checkInFreq);
    if (raw === undefined || raw === null || raw === "") return undefined;
    return String(raw).trim();
  })
  checkInFreq?: string;

  @IsString()
  @IsOptional()
  checkInFrequency?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  subscriptionStatus?: string;

  // Validação aninhada para o campo JSON
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
  notificationEnabled?: boolean = true;
}
