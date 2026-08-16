import { Controller, Post, Body } from '@nestjs/common';
import { AiService } from './ai.service';
import { GenerateWorkoutPlanDto } from './dto/generate-workout-plan.dto';
import { GenerateWorkoutInsightsDto } from './dto/generate-workout-insights.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('workout-plan')
  async generateWorkoutPlan(@Body() dto: GenerateWorkoutPlanDto) {
    return this.aiService.generateWorkoutPlan(dto);
  }

  @Post('workout-insights')
  async generateWorkoutInsights(@Body() dto: GenerateWorkoutInsightsDto) {
    return this.aiService.generateWorkoutInsights(dto);
  }
}
