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
  Res,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Response } from "express";

import { ClientsService } from "./clients.service";
import { AnamnesisService } from "../anamnesis/anamnesis.service";
import { CreateStudentDto } from "./create-student.dto";
import { UpdateClientDto } from "./clients-update.dto";
import { ManualPaymentDto } from "./manual-payment.dto";
import { UpdateStudentStatusDto } from "./update-status.dto";
import { StudentQueryDto } from "./student-query.dto";
import { RequestWithUser } from "../../types/global";

@UseGuards(AuthGuard("jwt"))
@Controller("students")
export class StudentsController {
  constructor(
    private readonly clientsService: ClientsService,
    @Inject(forwardRef(() => AnamnesisService))
    private readonly anamnesisService: AnamnesisService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Request() req: RequestWithUser,
    @Body() createStudentDto: CreateStudentDto,
  ) {
    return this.clientsService.create(req.user.userId, createStudentDto as any);
  }

  @Get()
  findAll(@Request() req: RequestWithUser, @Query() query: StudentQueryDto) {
    return this.clientsService.findStudents(req.user.userId, query);
  }

  @Get("export/csv")
  async exportCsv(@Request() req: RequestWithUser, @Res() res: Response) {
    const csvData = await this.clientsService.exportCsv(req.user.userId);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="students.csv"');
    res.status(HttpStatus.OK).send(csvData);
  }

  @Get("expiring-sheets")
  getExpiringSheets(@Request() req: RequestWithUser) {
    return this.clientsService.getExpiringSheets(req.user.userId);
  }

  @Get(":id")
  findOne(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.clientsService.findOne(req.user.userId, id);
  }

  @Patch(":id")
  update(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    return this.clientsService.update(req.user.userId, id, updateClientDto);
  }

  @Post(":id/manual-payment")
  recordManualPayment(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() manualPaymentDto: ManualPaymentDto,
  ) {
    return this.clientsService.recordManualPayment(
      req.user.userId,
      id,
      manualPaymentDto,
    );
  }

  @Patch(":id/status")
  updateStatus(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() updateStatusDto: UpdateStudentStatusDto,
  ) {
    return this.clientsService.updateStudentStatus(
      req.user.userId,
      id,
      updateStatusDto.status,
    );
  }

  @Post(":id/request-reassessment")
  @HttpCode(HttpStatus.OK)
  requestReassessment(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    return this.anamnesisService.requestReassessment(req.user.userId, id);
  }

  @Get(":id/activity-heatmap")
  getActivityHeatmap(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query("days") days?: number,
  ) {
    const numDays = days ? Number(days) : 30;
    return this.clientsService.getActivityHeatmap(req.user.userId, id, numDays);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.clientsService.remove(req.user.userId, id);
  }
}
