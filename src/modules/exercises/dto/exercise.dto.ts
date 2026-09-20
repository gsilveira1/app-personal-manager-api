import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class CreateExerciseDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  bodyPart!: string;

  @IsString()
  @IsOptional()
  targetMuscle?: string;

  @IsString()
  @IsNotEmpty()
  equipment!: string;

  @IsString()
  @IsOptional()
  gifUrl?: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;
}

export class ExerciseQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  bodyPart?: string;

  @IsString()
  @IsOptional()
  equipment?: string;
}
