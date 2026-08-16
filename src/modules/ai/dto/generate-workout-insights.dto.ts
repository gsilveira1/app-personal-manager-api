import { IsObject, IsOptional, IsArray, IsString } from "class-validator";

export class GenerateWorkoutInsightsDto {
  @IsObject()
  client!: any;

  @IsOptional()
  @IsObject()
  latestEvaluation?: any;

  @IsArray()
  archivedPlans!: any[];

  @IsOptional()
  @IsString()
  customInstructions?: string;
}
