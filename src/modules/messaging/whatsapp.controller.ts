import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../common/auth";
import { WhatsAppTestMessageDto } from "./dto/whatsapp-test-message.dto";
import { WhatsappConnectionService } from "./whatsapp-connection.service";

/** Endpoints 85–88: the trainer's WhatsApp connection. */
@UseGuards(JwtAuthGuard)
@Controller("whatsapp")
export class WhatsappController {
  constructor(private readonly connection: WhatsappConnectionService) {}

  @Post("connect")
  @HttpCode(HttpStatus.OK)
  connect(@CurrentUserId() userId: string) {
    return this.connection.connect(userId);
  }

  @Get("status")
  getStatus(@CurrentUserId() userId: string) {
    return this.connection.getStatus(userId);
  }

  @Post("disconnect")
  @HttpCode(HttpStatus.OK)
  disconnect(@CurrentUserId() userId: string) {
    return this.connection.disconnect(userId);
  }

  @Post("test-message")
  @HttpCode(HttpStatus.OK)
  sendTestMessage(
    @CurrentUserId() userId: string,
    @Body() dto: WhatsAppTestMessageDto,
  ) {
    return this.connection.sendTestMessage(userId, dto);
  }
}
