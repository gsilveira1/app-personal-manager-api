import { IsString, IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, IsEnum, ValidateNested, IsObject } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';

export enum SessionType {
  IN_PERSON = 'In-Person',
  ONLINE = 'Online',
}

export enum SessionCategory {
  WORKOUT = 'Workout',
  CHECK_IN = 'Check-in',
  EVALUATION = 'Evaluation',
}

export class CreateSessionDto {
  @IsDateString()
  @Transform(({ value }) => new Date(value).toISOString())
  date!: string;

  @IsInt()
  durationMinutes!: number;

  @IsString()
  type!: string;

  @IsString()
  category!: string;

  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  linkedWorkoutId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

export class CreateRecurringSessionDto {
  // Alterado de herança para composição para corresponder ao JSON do frontend
  @IsObject()
  @ValidateNested()
  @Type(() => CreateSessionDto)
  baseSession!: CreateSessionDto;

  @IsDateString()
  startDateStr!: string;

  @IsEnum(['weekly', 'bi-weekly'])
  frequency!: 'weekly' | 'bi-weekly';

  @IsDateString()
  untilDateStr!: string;
}

export class UpdateSessionDto extends PartialType(CreateSessionDto) {}

export class UpdateSessionScopeDto extends UpdateSessionDto {
  @IsEnum(['single', 'future'])
  scope!: 'single' | 'future';
}