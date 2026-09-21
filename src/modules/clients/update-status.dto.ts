import { IsEnum } from "class-validator";
import { ClientStatus } from "@prisma/client";
import { Transform } from "class-transformer";

export class UpdateStudentStatusDto {
  @Transform(({ value }) => {
    if (typeof value === "string") {
      const upper = value.toUpperCase();
      if (upper === "ACTIVE" || upper === "ATIVO") return ClientStatus.ACTIVE;
      if (upper === "PAUSED" || upper === "PAUSADA" || upper === "PAUSADO") return ClientStatus.PAUSED;
      if (upper === "OVERDUE" || upper === "EM ATRASO" || upper === "ATRASADO") return ClientStatus.OVERDUE;
      if (upper === "LEAD") return ClientStatus.LEAD;
    }
    return value;
  })
  @IsEnum(ClientStatus)
  status!: ClientStatus;
}
