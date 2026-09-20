import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsOptional,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ExerciseLoadDto {
  @IsString()
  @IsNotEmpty()
  workoutExerciseId!: string;

  @IsNumber()
  loadKg!: number;
}

export class CompleteStudentSessionDto {
  @IsString()
  @IsNotEmpty()
  workoutId!: string;

  @IsNumber()
  durationSeconds!: number;

  @IsString()
  @IsOptional()
  completedAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExerciseLoadDto)
  @IsOptional()
  loads?: ExerciseLoadDto[];
}
