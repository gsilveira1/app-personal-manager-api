import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { isRecordNotFound } from "../prisma-errors";
import { CreatePlanDto, UpdatePlanDto } from "./plan.dto";
import {
  PLAN_VIEW_INCLUDE,
  PlanView,
  PublicPlans,
  toPlanView,
  toPublicPlans,
} from "./plan.views";

/**
 * PATCH data: `null` is ignored for columns that cannot be null (the global
 * ValidationPipe lets `null` through `@IsOptional()`), so it never reaches Prisma.
 */
function buildPlanUpdate(dto: UpdatePlanDto): Prisma.PlanUpdateInput {
  return {
    type: dto.type ?? undefined,
    name: dto.name ?? undefined,
    sessionsPerWeek: dto.sessionsPerWeek ?? undefined,
    durationMinutes: dto.durationMinutes,
    price: dto.price ?? undefined,
    active: dto.active ?? undefined,
    features: dto.features ?? undefined,
  };
}

/** A write that matched no row (deleted since the ownership check) is a 404. */
function goneOr(error: unknown, id: string): unknown {
  return isRecordNotFound(error)
    ? new NotFoundException(`Plan #${id} not found`)
    : error;
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreatePlanDto): Promise<PlanView> {
    const row = await this.prisma.plan.create({
      data: {
        type: dto.type,
        name: dto.name,
        sessionsPerWeek: dto.sessionsPerWeek,
        durationMinutes: dto.durationMinutes,
        price: dto.price,
        active: dto.active,
        features: dto.features ?? [],
        userId,
      },
      include: PLAN_VIEW_INCLUDE,
    });
    return toPlanView(row);
  }

  async findAll(userId: string): Promise<PlanView[]> {
    const rows = await this.prisma.plan.findMany({
      where: { userId },
      include: PLAN_VIEW_INCLUDE,
    });
    return rows.map(toPlanView);
  }

  /**
   * @throws {NotFoundException} When the plan does not exist
   * @throws {ForbiddenException} When it belongs to another trainer
   */
  async findOne(userId: string, id: string): Promise<PlanView> {
    const row = await this.prisma.plan.findUnique({
      where: { id },
      include: PLAN_VIEW_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Plan #${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return toPlanView(row);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdatePlanDto,
  ): Promise<PlanView> {
    await this.findOne(userId, id);
    try {
      const row = await this.prisma.plan.update({
        where: { id, userId },
        data: buildPlanUpdate(dto),
        include: PLAN_VIEW_INCLUDE,
      });
      return toPlanView(row);
    } catch (error) {
      throw goneOr(error, id);
    }
  }

  /** Hard delete; clients of the plan keep existing with `planId` null (FK SET NULL). */
  async remove(userId: string, id: string): Promise<PlanView> {
    const plan = await this.findOne(userId, id);
    try {
      await this.prisma.plan.delete({ where: { id, userId } });
    } catch (error) {
      throw goneOr(error, id);
    }
    return plan;
  }

  /**
   * Guard used before a client is linked to a plan.
   * @throws {BadRequestException} When the plan is not one of the trainer's plans
   */
  async requireAssignable(userId: string, planId: string): Promise<void> {
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, userId },
      select: { id: true },
    });
    if (!plan) {
      throw new BadRequestException("planId is not one of your plans");
    }
  }

  /** Active plans of a trainer for the public site (`GET /public/:slug/plans`). */
  async findPublicByTrainer(trainerId: string): Promise<PublicPlans> {
    const rows = await this.prisma.plan.findMany({
      where: { userId: trainerId, active: true },
      select: {
        id: true,
        type: true,
        name: true,
        sessionsPerWeek: true,
        durationMinutes: true,
        price: true,
        features: true,
      },
    });
    return toPublicPlans(rows);
  }
}
