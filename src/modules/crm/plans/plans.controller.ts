import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import { CreatePlanDto, UpdatePlanDto } from "./plan.dto";
import { PlanView } from "./plan.views";
import { PlansService } from "./plans.service";

@UseGuards(JwtAuthGuard)
@Controller("plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreatePlanDto,
  ): Promise<PlanView> {
    return this.plans.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUserId() userId: string): Promise<PlanView[]> {
    return this.plans.findAll(userId);
  }

  @Get(":id")
  findOne(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<PlanView> {
    return this.plans.findOne(userId, id);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<PlanView> {
    return this.plans.update(userId, id, dto);
  }

  @Delete(":id")
  remove(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<PlanView> {
    return this.plans.remove(userId, id);
  }
}
