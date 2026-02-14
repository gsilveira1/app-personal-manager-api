import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { SessionsService } from './sessions.service';
import { CreateSessionDto, CreateRecurringSessionDto, UpdateSessionScopeDto } from './sessions.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt'))
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  create(@Request() req: RequestWithUser, @Body() createSessionDto: CreateSessionDto) {
    return this.sessionsService.create(req.user!.userId, createSessionDto);
  }

  @Post('recurring')
  @HttpCode(HttpStatus.CREATED)
  createRecurring(@Request() req: RequestWithUser, @Body() dto: CreateRecurringSessionDto) {
    const { startDateStr, frequency, untilDateStr, baseSession } = dto;
    return this.sessionsService.createRecurring(
      req.user!.userId,
      baseSession,
      startDateStr,
      frequency,
      untilDateStr,
    );
  }

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.sessionsService.findAll(req.user!.userId);
  }

  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.sessionsService.findOne(req.user!.userId, id);
  }

  @Patch(':id/scope')
  updateWithScope(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateDto: UpdateSessionScopeDto,
  ) {
    const { scope, ...data } = updateDto;
    return this.sessionsService.updateWithScope(req.user!.userId, id, data, scope);
  }

  @Patch(':id/toggle-complete')
  toggleComplete(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.sessionsService.toggleComplete(req.user!.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.sessionsService.remove(req.user!.userId, id);
  }
}