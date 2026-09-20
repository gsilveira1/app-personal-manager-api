import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsNumber,
  IsIn,
} from "class-validator";
import { Type } from "class-transformer";

export class WorkoutExerciseItemDto {
  @IsString()
  @IsOptional()
  exerciseId?: string;

  @IsString()
  @IsOptional()
  exerciseName?: string;

  @IsString()
  @IsOptional()
  gifUrl?: string;

  @IsNumber()
  @IsOptional()
  sets: number = 3;

  @IsString()
  @IsOptional()
  reps: string = "10-12";

  @IsNumber()
  @IsOptional()
  suggestedLoadKg?: number;

  @IsString()
  @IsOptional()
  executionNotes?: string;

  @IsNumber()
  @IsOptional()
  orderIndex: number = 0;
}

export class WorkoutBlockDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(["REGULAR", "BISET", "TRISET"])
  type!: string;

  @IsNumber()
  @IsOptional()
  orderIndex: number = 0;

  @IsNumber()
  @IsOptional()
  restTimeSeconds: number = 60;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseItemDto)
  exercises!: WorkoutExerciseItemDto[];
}

export class WorkoutSheetItemDto {
  @IsString()
  @IsNotEmpty()
  letter!: string; // 'A', 'B', 'C'

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @IsOptional()
  orderIndex: number = 0;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutBlockDto)
  blocks!: WorkoutBlockDto[];
}

export class CreateWorkoutSheetDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutSheetItemDto)
  workouts!: WorkoutSheetItemDto[];
}

export class SaveWorkoutTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
