import { Body, Controller, Get, Patch, Put, UseGuards } from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import {
  UpdateAiInstructionsDto,
  UpdateDndDto,
  UpdateLanguageDto,
  UpdateWorkHoursDto,
} from "./settings.dto";
import { SettingsService } from "./settings.service";

@UseGuards(JwtAuthGuard)
@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("ai-instructions")
  getAiInstructions(@CurrentUserId() userId: string) {
    return this.settingsService.getAiInstructions(userId);
  }

  @Put("ai-instructions")
  updateAiInstructions(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateAiInstructionsDto,
  ) {
    return this.settingsService.updateAiInstructions(userId, dto.instructions);
  }

  @Get("language")
  getLanguage(@CurrentUserId() userId: string) {
    return this.settingsService.getLanguage(userId);
  }

  @Patch("language")
  updateLanguage(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateLanguageDto,
  ) {
    return this.settingsService.updateLanguage(userId, dto.language);
  }

  @Get("work-hours")
  getWorkHours(@CurrentUserId() userId: string) {
    return this.settingsService.getWorkHours(userId);
  }

  @Put("work-hours")
  updateWorkHours(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateWorkHoursDto,
  ) {
    return this.settingsService.updateWorkHours(userId, dto);
  }

  @Patch("dnd")
  updateDnd(@CurrentUserId() userId: string, @Body() dto: UpdateDndDto) {
    return this.settingsService.updateDnd(userId, dto);
  }
}
