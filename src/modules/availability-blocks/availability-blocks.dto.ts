import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateAvailabilityBlockDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  rrule?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsDateString()
  dtstart!: string;

  @IsDateString()
  dtend!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAvailabilityBlockDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  rrule?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsDateString()
  dtstart?: string;

  @IsOptional()
  @IsDateString()
  dtend?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
