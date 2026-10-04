import { IsNotEmpty, IsOptional, IsString } from "class-validator";

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

/** Contract 6.3: one row of the exercise catalogue. */
export interface ExerciseView {
  id: string;
  name: string;
  bodyPart: string;
  targetMuscle: string | null;
  equipment: string;
  gifUrl: string | null;
  videoUrl: string | null;
  /** true for a trainer's private exercise, false for a global (seeded) one. */
  isCustom: boolean;
  createdAt: Date;
  updatedAt: Date;
}
