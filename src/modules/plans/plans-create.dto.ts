import { IsString, IsInt, IsNumber, IsOptional, IsBoolean, IsIn, Min, Max } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @IsIn(['PRESENCIAL', 'CONSULTORIA'])
  type!: 'PRESENCIAL' | 'CONSULTORIA';

  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  @Max(6)
  sessionsPerWeek!: number;

  @IsOptional()
  @IsInt()
  @IsIn([30, 45, 60, 90])
  durationMinutes?: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
