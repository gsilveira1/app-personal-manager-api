import { PartialType } from "@nestjs/mapped-types";
import { IsDefined, IsIn, IsString, MaxLength } from "class-validator";
import {
  DayScheduleDto,
  DndConfigDto,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
  WorkHoursDto,
} from "../../../common/types";

export class UpdateAiInstructionsDto {
  @IsString()
  @MaxLength(10_000)
  instructions!: string;
}

export class UpdateLanguageDto {
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES, {
    message: "language must be one of: 'en', 'es', 'pt-BR'",
  })
  language!: SupportedLanguage;
}

/**
 * Body of PUT /settings/work-hours: the whole week, `start` / `end` as HH:mm.
 * WorkHoursDto validates each day that is present; a request must send all seven.
 */
export class UpdateWorkHoursDto extends WorkHoursDto {
  @IsDefined() monday!: DayScheduleDto;
  @IsDefined() tuesday!: DayScheduleDto;
  @IsDefined() wednesday!: DayScheduleDto;
  @IsDefined() thursday!: DayScheduleDto;
  @IsDefined() friday!: DayScheduleDto;
  @IsDefined() saturday!: DayScheduleDto;
  @IsDefined() sunday!: DayScheduleDto;
}

/** Body of PATCH /settings/dnd: any subset of `enabled`, `startHour`, `endHour`, `timezone`. */
export class UpdateDndDto extends PartialType(DndConfigDto) {}
