import { IsOptional, IsString, IsUUID } from "class-validator";

/** Body of `PATCH /clients/:id/convert`. */
export class ConvertLeadDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  planId?: string;
}
