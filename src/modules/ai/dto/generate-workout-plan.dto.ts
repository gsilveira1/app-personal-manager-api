import { IsString, IsNumber, IsOptional, IsObject } from 'class-validator';

export class GenerateWorkoutPlanDto {
  @IsString()
  clientName!: string;

  @IsString()
  goal!: string;

  @IsString()
  experienceLevel!: string;

  @IsOptional()
  @IsString()
  limitations?: string;

  @IsNumber()
  daysPerWeek!: number;

  @IsOptional()
  @IsObject()
  client?: any;

  @IsOptional()
  @IsObject()
  latestEvaluation?: any;

  @IsOptional()
  @IsString()
  customInstructions?: string;
}
