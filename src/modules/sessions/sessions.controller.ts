import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { SessionsService } from './sessions.service';
import { CreateSessionDto, CreateRecurringSessionDto, UpdateSessionScopeDto } from './sessions.dto';
import { CreateRecurringEventDto, UpsertSessionExceptionDto } from './sessions-rrule.dto';
import { RequestWithUser } from '../../types/global';

// ─── Public endpoint helper ───────────────────────────────────────────────────
// The `TRAINER_USER_ID` env var is used to scope public availability requests
// without exposing any auth tokens.
const TRAINER_USER_ID = process.env.TRAINER_USER_ID ?? '';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) { }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC — no JWT required
  // ═══════════════════════════════════════════════════════════

  /**
   * Public endpoint for the website calendar.
   * Returns available (free) time slots, never client details.
   * GET /sessions/available?start=2025-03-01&end=2025-03-31
   */
  @Get('available')
  async getAvailableSlots(
    @Query('start') startStr: string,
    @Query('end') endStr: string,
  ) {
    if (!TRAINER_USER_ID) return [];
    const start = new Date(startStr || new Date().toISOString().split('T')[0]);
    const end = new Date(endStr || new Date(start.getTime() + 30 * 24 * 3_600_000).toISOString().split('T')[0]);
    return this.sessionsService.findAvailableSlots(TRAINER_USER_ID, start, end);
  }

  // ═══════════════════════════════════════════════════════════
  //  PROTECTED — JWT required from here on
  // ═══════════════════════════════════════════════════════════

  // ── Legacy single session ────────────────────────────────
  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(@Request() req: RequestWithUser, @Body() dto: CreateSessionDto) {
    return this.sessionsService.create(req.user!.userId, dto);
  }

  /** @deprecated — kept for backward compatibility. Use POST /sessions/recurring-event instead. */
  @UseGuards(AuthGuard('jwt'))
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

  // ── RRULE-based recurrence ────────────────────────────────

  /**
   * Create a new RRULE-based recurring event master.
   * POST /sessions/recurring-event
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('recurring-event')
  @HttpCode(HttpStatus.CREATED)
  createRecurringEvent(
    @Request() req: RequestWithUser,
    @Body() dto: CreateRecurringEventDto,
  ) {
    return this.sessionsService.createRecurringEvent(req.user!.userId, dto);
  }

  /**
   * Delete an entire recurring series.
   * DELETE /sessions/recurring-event/:id
   */
  @UseGuards(AuthGuard('jwt'))
  @Delete('recurring-event/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRecurringEvent(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.sessionsService.removeRecurringEvent(req.user!.userId, id);
  }

  /**
   * Upsert an exception for a single occurrence (edit or cancel it).
   * PATCH /sessions/exception
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch('exception')
  upsertException(
    @Request() req: RequestWithUser,
    @Body() dto: UpsertSessionExceptionDto,
  ) {
    return this.sessionsService.upsertSessionException(req.user!.userId, dto);
  }

  // ── Calendar queries ─────────────────────────────────────

  /**
   * Windowed session fetch for calendar views (merges legacy + virtual).
   * GET /sessions?start=2025-03-01&end=2025-03-31
   * Falls back to findAll (all sessions) when no range is provided.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(
    @Request() req: RequestWithUser,
    @Query('start') startStr?: string,
    @Query('end') endStr?: string,
  ) {
    if (startStr && endStr) {
      return this.sessionsService.findAllForRange(
        req.user!.userId,
        new Date(startStr),
        new Date(endStr),
      );
    }
    return this.sessionsService.findAll(req.user!.userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.sessionsService.findOne(req.user!.userId, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id/scope')
  updateWithScope(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateDto: UpdateSessionScopeDto,
  ) {
    const { scope, ...data } = updateDto;
    return this.sessionsService.updateWithScope(req.user!.userId, id, data, scope);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/toggle-complete')
  toggleComplete(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.sessionsService.toggleComplete(req.user!.userId, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.sessionsService.remove(req.user!.userId, id);
  }
}