import { PartialType } from "@nestjs/mapped-types";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

import { PlanFeatureKey } from "../../../common/types";

/** BRL. */
export const MAX_PLAN_PRICE = 1_000_000;
/** Upper bound of the feature list; the catalogue itself is smaller. */
export const MAX_PLAN_FEATURES = 20;

export class CreatePlanDto {
  @IsString()
  @IsIn(["PRESENCIAL", "CONSULTORIA"])
  type!: "PRESENCIAL" | "CONSULTORIA";

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(6)
  sessionsPerWeek!: number;

  @IsOptional()
  @IsInt()
  @IsIn([30, 45, 60, 90])
  durationMinutes?: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_PLAN_PRICE)
  price!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Replaces `featureIds`: keys of the code catalogue, not table ids. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLAN_FEATURES)
  @ArrayUnique()
  @IsEnum(PlanFeatureKey, { each: true })
  features?: PlanFeatureKey[];
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
