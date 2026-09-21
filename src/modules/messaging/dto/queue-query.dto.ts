import { IsOptional, IsString, IsIn, IsNumber } from "class-validator";
import { Type } from "class-transformer";

export class QueueQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(["ALL", "QUEUED", "SENT", "FAILED", "CANCELLED"])
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(["ALL", "WHATSAPP", "EMAIL"])
  channel?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}
