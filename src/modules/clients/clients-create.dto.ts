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
  IsUUID 
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ClientStatus } from '@prisma/client';

// DTO para validar o objeto JSON de histórico médico
class MedicalHistoryDto {
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
  status?: ClientStatus; // Default é Active no banco, mas pode ser enviado

  @IsString()
  type!: string; // 'In-Person' | 'Online'

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
  @Transform(({ value }) => value ? new Date(value).toISOString() : value)
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  checkInFreq?: string;

  // Validação aninhada para o campo JSON
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MedicalHistoryDto)
  medicalHistory?: MedicalHistoryDto;

  @IsOptional()
  @IsUUID()
  planId?: string;
}