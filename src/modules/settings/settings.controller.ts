import { Controller, Get, Put, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { SettingsService } from './settings.service';
import { UpdateAiInstructionsDto, UpdateLanguageDto, UpdateWorkHoursDto } from './settings.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt'))
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('ai-instructions')
  getAiInstructions(@Request() req: RequestWithUser) {
    return this.settingsService.getAiInstructions(req.user.userId);
  }

  @Put('ai-instructions')
  updateAiInstructions(@Request() req: RequestWithUser, @Body() dto: UpdateAiInstructionsDto) {
    return this.settingsService.updateAiInstructions(req.user.userId, dto.instructions);
  }

  @Get('language')
  getLanguage(@Request() req: RequestWithUser) {
    return this.settingsService.getLanguage(req.user.userId);
  }

  @Patch('language')
  updateLanguage(@Request() req: RequestWithUser, @Body() dto: UpdateLanguageDto) {
    return this.settingsService.updateLanguage(req.user.userId, dto.language);
  }

  @Get('work-hours')
  getWorkHours(@Request() req: RequestWithUser) {
    return this.settingsService.getWorkHours(req.user.userId);
  }

  @Put('work-hours')
  updateWorkHours(@Request() req: RequestWithUser, @Body() dto: UpdateWorkHoursDto) {
    return this.settingsService.updateWorkHours(req.user.userId, dto);
  }
}