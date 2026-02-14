import { IsString, IsInt, IsNumber, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  sessionsPerWeek!: number;

  @IsInt()
  @Min(15)
  sessionDurationMinutes!: number;

  @IsNumber()
  @Min(0)
  pricePerSession!: number;
}