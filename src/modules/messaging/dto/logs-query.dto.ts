import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export const LOG_STATUS_FILTERS = ["ALL", "SENT", "FAILED", "CANCELLED"];
export const LOG_CHANNEL_FILTERS = ["ALL", "WHATSAPP", "EMAIL"];
export const LOGS_MAX_LIMIT = 100;

/** Query string of `GET /messaging/logs`. */
export class LogsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(LOG_STATUS_FILTERS)
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(LOG_CHANNEL_FILTERS)
  channel?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LOGS_MAX_LIMIT)
  limit?: number = 20;
}
