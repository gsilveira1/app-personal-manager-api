import { ClientStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum } from "class-validator";

import { parseClientStatus } from "../client-parsing";

/** Body of `PATCH /clients/:id/status`. */
export class UpdateClientStatusDto {
  @Transform(({ value }) => parseClientStatus(value) ?? value)
  @IsEnum(ClientStatus)
  status!: ClientStatus;
}
