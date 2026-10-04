import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

import {
  AI_ARCHIVED_PLAN_KEYS,
  AI_CLIENT_KEYS,
  AI_EVALUATION_KEYS,
  AI_INSTRUCTIONS_MAX_LENGTH,
  AI_MAX_ARCHIVED_PLANS,
  AiArchivedPlanDto,
  AiClientDto,
  AiEvaluationDto,
  PickNested,
} from "./ai-context.dto";

/** Body of `POST /ai/workout-insights`. */
export class GenerateWorkoutInsightsDto {
  @IsDefined()
  @PickNested(() => AiClientDto, AI_CLIENT_KEYS)
  @ValidateNested()
  client!: AiClientDto;

  @IsOptional()
  @PickNested(() => AiEvaluationDto, AI_EVALUATION_KEYS)
  @ValidateNested()
  latestEvaluation?: AiEvaluationDto;

  @IsArray()
  @ArrayMaxSize(AI_MAX_ARCHIVED_PLANS)
  @PickNested(() => AiArchivedPlanDto, AI_ARCHIVED_PLAN_KEYS)
  @ValidateNested({ each: true })
  archivedPlans!: AiArchivedPlanDto[];

  /** Overrides the trainer's stored `settings.aiInstructions` for this request. */
  @IsOptional()
  @IsString()
  @MaxLength(AI_INSTRUCTIONS_MAX_LENGTH)
  customInstructions?: string;
}
