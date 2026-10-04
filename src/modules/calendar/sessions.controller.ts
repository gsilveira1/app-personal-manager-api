import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentUserId, JwtAuthGuard } from "../../common/auth";
import { SessionView } from "./calendar.types";
import { parseOptionalRange } from "./date-range";
import { CreateSessionDto, UpdateSessionDto } from "./dto/session.dto";
import { SessionsService } from "./sessions.service";

/** Endpoints 60–65. `:id` is a UUID or an occurrence id `<seriesId>_<ISO originalStartTime>`. */
@UseGuards(JwtAuthGuard)
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  /** POST /sessions — one-off session, or a series when `rrule` is sent. */
  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionView> {
    return this.sessionsService.create(userId, dto);
  }

  /**
   * GET /sessions?start=2025-03-01&end=2025-03-31 — calendar window (stored + expanded).
   * Without a range it lists one-off sessions only.
   */
  @Get()
  findAll(
    @CurrentUserId() userId: string,
    @Query("start") start?: string,
    @Query("end") end?: string,
  ): Promise<SessionView[]> {
    return this.sessionsService.findAll(userId, parseOptionalRange(start, end));
  }

  @Get(":id")
  findOne(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<SessionView> {
    return this.sessionsService.findOne(userId, id);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateSessionDto,
  ): Promise<SessionView> {
    return this.sessionsService.update(userId, id, dto);
  }

  @Post(":id/toggle-complete")
  toggleComplete(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<SessionView> {
    return this.sessionsService.toggleComplete(userId, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<void> {
    return this.sessionsService.remove(userId, id);
  }
}
