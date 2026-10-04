import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

import {
  AI_CLIENT_KEYS,
  AI_EVALUATION_KEYS,
  AI_GOAL_MAX_LENGTH,
  AI_INSTRUCTIONS_MAX_LENGTH,
  AI_NAME_MAX_LENGTH,
  AiClientDto,
  AiEvaluationDto,
  PickNested,
} from "./ai-context.dto";

export const AI_EXPERIENCE_LEVEL_MAX_LENGTH = 100;
export const AI_LIMITATIONS_MAX_LENGTH = 2000;

/** Body of `POST /ai/workout-plan`. */
export class GenerateWorkoutPlanDto {
  @IsString()
  @MaxLength(AI_NAME_MAX_LENGTH)
  clientName!: string;

  @IsString()
  @MaxLength(AI_GOAL_MAX_LENGTH)
  goal!: string;

  @IsString()
  @MaxLength(AI_EXPERIENCE_LEVEL_MAX_LENGTH)
  experienceLevel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITATIONS_MAX_LENGTH)
  limitations?: string;

  @IsInt()
  @Min(1)
  @Max(7)
  daysPerWeek!: number;

  @IsOptional()
  @PickNested(() => AiClientDto, AI_CLIENT_KEYS)
  @ValidateNested()
  client?: AiClientDto;

  @IsOptional()
  @PickNested(() => AiEvaluationDto, AI_EVALUATION_KEYS)
  @ValidateNested()
  latestEvaluation?: AiEvaluationDto;

  /** Overrides the trainer's stored `settings.aiInstructions` for this request. */
  @IsOptional()
  @IsString()
  @MaxLength(AI_INSTRUCTIONS_MAX_LENGTH)
  customInstructions?: string;
}
