import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { MessagingService } from "./messaging.service";
import { ResendLinkDto } from "./dto/messaging.dto";
import { RequestWithUser } from "../../types/global";

@UseGuards(AuthGuard("jwt"))
@Controller("students/:id/resend-link")
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post()
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
}
