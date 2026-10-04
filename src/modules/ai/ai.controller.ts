import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../common/auth";
import { AiService } from "./ai.service";
import { GenerateWorkoutPlanDto } from "./dto/generate-workout-plan.dto";
import { GenerateWorkoutInsightsDto } from "./dto/generate-workout-insights.dto";

/** AI generation spends the provider quota, so both endpoints require a trainer session. */
@UseGuards(JwtAuthGuard)
@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("workout-plan")
  async generateWorkoutPlan(
    @CurrentUserId() userId: string,
    @Body() dto: GenerateWorkoutPlanDto,
  ) {
    return this.aiService.generateWorkoutPlan(userId, dto);
  }

  @Post("workout-insights")
  async generateWorkoutInsights(
    @CurrentUserId() userId: string,
    @Body() dto: GenerateWorkoutInsightsDto,
  ) {
    return this.aiService.generateWorkoutInsights(userId, dto);
  }
}
