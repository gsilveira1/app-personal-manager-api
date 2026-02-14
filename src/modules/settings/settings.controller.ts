import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { SettingsService } from './settings.service';
import { UpdateAiInstructionsDto } from './settings.dto';
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
}