import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import {
  ClientPaymentsService,
  RecordedPayment,
} from "./client-payments.service";
import {
  ClientDetail,
  ClientListItem,
  ClientView,
  WelcomeMessageOutcome,
} from "./client.views";
import { ClientsService, Paginated } from "./clients.service";
import { AvatarUploadDto } from "./dto/avatar-upload.dto";
import { ClientQueryDto } from "./dto/client-query.dto";
import { ConvertLeadDto } from "./dto/convert-lead.dto";
import { CreateClientDto } from "./dto/create-client.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
import { UpdateClientStatusDto } from "./dto/update-client-status.dto";
import { UpdateClientDto } from "./dto/update-client.dto";

@UseGuards(JwtAuthGuard)
@Controller("clients")
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly payments: ClientPaymentsService,
  ) {}

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateClientDto,
  ): Promise<ClientView & { welcomeMessage: WelcomeMessageOutcome }> {
    return this.clients.create(userId, dto);
  }

  @Get()
  findPage(
    @CurrentUserId() userId: string,
    @Query() query: ClientQueryDto,
  ): Promise<Paginated<ClientListItem>> {
    return this.clients.findPage(userId, query);
  }

  // Static paths are declared before ":id" so they are not captured by it.
  @Get("leads")
  findLeads(@CurrentUserId() userId: string): Promise<ClientView[]> {
    return this.clients.findLeads(userId);
  }

  @Get("export/csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="clients.csv"')
  exportCsv(@CurrentUserId() userId: string): Promise<string> {
    return this.clients.exportCsv(userId);
  }

  @Get(":id")
  findOne(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<ClientDetail> {
    return this.clients.findOne(userId, id);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateClientDto,
  ): Promise<ClientView> {
    return this.clients.update(userId, id, dto);
  }

  @Patch(":id/status")
  updateStatus(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateClientStatusDto,
  ): Promise<ClientView> {
    return this.clients.updateStatus(userId, id, dto.status);
  }

  @Patch(":id/convert")
  convertLead(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: ConvertLeadDto,
  ): Promise<ClientView> {
    return this.clients.convertLead(userId, id, dto.planId);
  }

  @Post(":id/avatar-upload-url")
  generateAvatarUploadUrl(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: AvatarUploadDto,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    return this.clients.generateAvatarUploadUrl(userId, id, dto.contentType);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<void> {
    return this.clients.remove(userId, id);
  }

  @Post(":id/payments")
  recordPayment(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: RecordPaymentDto,
  ): Promise<RecordedPayment> {
    return this.payments.record(userId, id, dto);
  }
}
