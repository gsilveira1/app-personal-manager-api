import { OmitType, PartialType } from "@nestjs/mapped-types";
import { IsDateString, IsUUID } from "class-validator";
import { PhysicalEvaluationMetricsDto } from "../../../common/types";

/** Body of `POST /evaluations`: the metrics plus the client and the evaluation date. */
export class CreateEvaluationDto extends PhysicalEvaluationMetricsDto {
  @IsUUID()
  clientId!: string;

  @IsDateString()
  date!: string;
}

/** Body of `PATCH /evaluations/:id`. An evaluation cannot be moved to another client. */
export class UpdateEvaluationDto extends PartialType(
  OmitType(CreateEvaluationDto, ["clientId"] as const),
) {}
