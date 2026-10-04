import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../common/auth";
import { LogsQueryDto } from "./dto/logs-query.dto";
import { MessagingHistoryService } from "./messaging-history.service";
import { PendingNotificationsService } from "./pending-notifications.service";

/** Endpoints 80–83: audit trail and pending jobs of the authenticated trainer. */
@UseGuards(JwtAuthGuard)
@Controller("messaging")
export class MessagingController {
  constructor(
    private readonly history: MessagingHistoryService,
    private readonly pending: PendingNotificationsService,
  ) {}

  @Get("logs")
  getLogs(@CurrentUserId() userId: string, @Query() query: LogsQueryDto) {
    return this.history.getLogs(userId, query);
  }

  @Get("pending")
  getPending(@CurrentUserId() userId: string) {
    return this.pending.list(userId);
  }

  @Post("pending/flush")
  @HttpCode(HttpStatus.OK)
  flushPending(@CurrentUserId() userId: string) {
    return this.pending.flush(userId);
  }

  @Delete("pending/:jobId")
  @HttpCode(HttpStatus.OK)
  cancelPending(
    @CurrentUserId() userId: string,
    @Param("jobId") jobId: string,
  ) {
    return this.pending.cancel(userId, jobId);
  }
}

/** Endpoint 84: `GET /clients/:id/messages`. */
@UseGuards(JwtAuthGuard)
@Controller("clients/:id")
export class ClientMessagesController {
  constructor(private readonly history: MessagingHistoryService) {}

  @Get("messages")
  getClientMessages(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
  ) {
    return this.history.getClientMessages(userId, clientId);
  }
}
