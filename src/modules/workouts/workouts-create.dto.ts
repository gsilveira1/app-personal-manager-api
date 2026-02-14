import { IsString, IsArray, IsOptional, IsUUID, ValidateNested, IsInt, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class ExerciseDto {
  @IsString()
  name!: string;

  @IsInt()
  sets!: number;

  @IsString() // Reps como string permite '12-15' ou 'Falha'
  reps!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isWarmup?: boolean;
}

export class CreateWorkoutDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  status?: string; // 'Active' | 'Archived'

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExerciseDto)
  exercises!: ExerciseDto[];

  @IsOptional()
  @IsUUID()
  clientId?: string;
}