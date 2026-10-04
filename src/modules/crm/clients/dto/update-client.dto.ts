import { OmitType, PartialType } from "@nestjs/mapped-types";
import { Transform } from "class-transformer";
import { IsOptional, IsUUID } from "class-validator";

import { CreateClientDto } from "./create-client.dto";

/** Body of `PATCH /clients/:id`. `planId: null` unlinks the plan. */
export class UpdateClientDto extends PartialType(
  OmitType(CreateClientDto, ["planId"] as const),
) {
  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @IsUUID()
  planId?: string | null;
}
