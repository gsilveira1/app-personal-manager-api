import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { MessagingService } from "./messaging.service";
import { ResendLinkDto } from "./dto/messaging.dto";
import { QueueQueryDto } from "./dto/queue-query.dto";
import { RequestWithUser } from "../../types/global";

@UseGuards(AuthGuard("jwt"))
@Controller("messaging")
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get("queue")
  getQueue(@Request() req: RequestWithUser, @Query() query: QueueQueryDto) {
    return this.messagingService.getTenantQueue(req.user.userId, query);
  }

  @Post("queue/:id/retry")
  @HttpCode(HttpStatus.OK)
  retryMessage(@Request() req: RequestWithUser, @Param("id") logId: string) {
    return this.messagingService.retryNotification(req.user.userId, logId);
  }

  @Delete("queue/:id")
  @HttpCode(HttpStatus.OK)
  cancelMessage(@Request() req: RequestWithUser, @Param("id") logId: string) {
    return this.messagingService.cancelNotification(req.user.userId, logId);
  }
}

@UseGuards(AuthGuard("jwt"))
@Controller("students/:id")
export class StudentMessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post("resend-link")
  @HttpCode(HttpStatus.OK)
  resendLink(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
    @Body() dto: ResendLinkDto,
  ) {
    return this.messagingService.resendLink(
      req.user.userId,
      clientId,
      dto.type,
    );
  }

  @Get("messages")
  getClientMessages(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
  ) {
    return this.messagingService.getClientMessageHistory(
      req.user.userId,
      clientId,
    );
  }
}

