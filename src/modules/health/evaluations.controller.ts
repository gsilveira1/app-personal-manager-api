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
import { CurrentUserId, JwtAuthGuard } from "../../common/auth";
import { EvaluationsService } from "./evaluations.service";
import { CreateEvaluationDto, UpdateEvaluationDto } from "./dto/evaluation.dto";

@UseGuards(JwtAuthGuard)
@Controller("evaluations")
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUserId() userId: string, @Body() dto: CreateEvaluationDto) {
    return this.evaluations.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUserId() userId: string) {
    return this.evaluations.findAll(userId);
  }

  @Get(":id")
  findOne(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.evaluations.findOne(userId, id);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateEvaluationDto,
  ) {
    return this.evaluations.update(userId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.evaluations.remove(userId, id);
  }
}
