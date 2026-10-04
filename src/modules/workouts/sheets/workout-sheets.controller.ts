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
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import {
  CreateSheetDto,
  CreateTemplateDto,
  SaveAsTemplateDto,
  UpdateSheetDto,
} from "./sheet.dto";
import { WorkoutSheetsService } from "./workout-sheets.service";

@UseGuards(JwtAuthGuard)
@Controller("clients/:id/workout-sheets")
export class ClientWorkoutSheetsController {
  constructor(private readonly sheets: WorkoutSheetsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
    @Body() dto: CreateSheetDto,
  ) {
    return this.sheets.createForClient(userId, clientId, dto);
  }

  @Get()
  findByClient(@CurrentUserId() userId: string, @Param("id") clientId: string) {
    return this.sheets.findByClient(userId, clientId);
  }
}

@UseGuards(JwtAuthGuard)
@Controller("workout-sheets")
export class WorkoutSheetsController {
  constructor(private readonly sheets: WorkoutSheetsService) {}

  // Declared before ":id" so that "expiring" is not read as a sheet id.
  @Get("expiring")
  findExpiring(@CurrentUserId() userId: string) {
    return this.sheets.findExpiring(userId);
  }

  @Get(":id")
  findOne(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.sheets.findOne(userId, id);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateSheetDto,
  ) {
    return this.sheets.update(userId, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.sheets.remove(userId, id);
  }
}

@UseGuards(JwtAuthGuard)
@Controller("workout-templates")
export class WorkoutTemplatesController {
  constructor(private readonly sheets: WorkoutSheetsService) {}

  @Get()
  findAll(@CurrentUserId() userId: string) {
    return this.sheets.findTemplates(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUserId() userId: string, @Body() dto: CreateTemplateDto) {
    return this.sheets.createTemplate(userId, dto);
  }

  @Post("from-sheet/:sheetId")
  @HttpCode(HttpStatus.CREATED)
  createFromSheet(
    @CurrentUserId() userId: string,
    @Param("sheetId") sheetId: string,
    @Body() dto: SaveAsTemplateDto,
  ) {
    return this.sheets.saveAsTemplate(userId, sheetId, dto);
  }
}
