import { IsString, IsIn, IsObject, ValidateNested, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAiInstructionsDto {
  @IsString()
  instructions!: string;
}

export class UpdateLanguageDto {
  @IsString()
  @IsIn(['en', 'es', 'pt-BR'], { message: "language must be one of: 'en', 'es', 'pt-BR'" })
  language!: string;
}

class DayScheduleDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  start!: string;

  @IsString()
  end!: string;
}

export class UpdateWorkHoursDto {
  @ValidateNested()
  @Type(() => DayScheduleDto)
  monday!: DayScheduleDto;

  @ValidateNested()
  @Type(() => DayScheduleDto)
  tuesday!: DayScheduleDto;

  @ValidateNested()
  @Type(() => DayScheduleDto)
  wednesday!: DayScheduleDto;

  @ValidateNested()
  @Type(() => DayScheduleDto)
  thursday!: DayScheduleDto;

  @ValidateNested()
  @Type(() => DayScheduleDto)
  friday!: DayScheduleDto;

  @ValidateNested()
  @Type(() => DayScheduleDto)
  saturday!: DayScheduleDto;

  @ValidateNested()
  @Type(() => DayScheduleDto)
  sunday!: DayScheduleDto;

  @IsInt()
  @Min(15)
  @Max(120)
  slotDurationMinutes!: number;
}