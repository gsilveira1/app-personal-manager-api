import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class UpdateDndSettingsDto {
  @IsOptional()
  @IsBoolean()
  dndEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  dndStartHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  dndEndHour?: number;

  @IsOptional()
  @IsString()
  dndTimezone?: string;
}
