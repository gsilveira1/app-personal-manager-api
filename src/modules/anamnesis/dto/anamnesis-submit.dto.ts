import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsObject,
} from "class-validator";

export class SubmitAnamnesisDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsOptional()
  medicalHistory?: string;

  @IsString()
  @IsOptional()
  injuriesAndPain?: string;

  @IsString()
  @IsOptional()
  routineAndSchedule?: string;

  @IsString()
  @IsOptional()
  fitnessGoals?: string;

  @IsString()
  @IsOptional()
  experienceLevel?: string;

  @IsObject()
  @IsOptional()
  parqAnswers?: Record<string, boolean>;

  @IsString()
  @IsOptional()
  frontPhotoUrl?: string;

  @IsString()
  @IsOptional()
  backPhotoUrl?: string;

  @IsString()
  @IsOptional()
  sidePhotoUrl?: string;

  @IsNumber()
  @IsOptional()
  weightKg?: number;

  @IsObject()
  @IsOptional()
  measurements?: Record<string, number>;
}
