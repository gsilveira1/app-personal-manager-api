import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './plans-create.dto';

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, data: CreatePlanDto) {
    const { featureIds, ...planData } = data;

    return this.prisma.plan.create({
      data: {
        ...planData,
        userId,
        ...(featureIds?.length && {
          features: {
            create: featureIds.map((featureId) => ({ featureId })),
          },
        }),
      },
      include: {
        features: { include: { feature: true } },
        _count: { select: { clients: true } },
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.plan.findMany({
      where: { userId },
      include: {
        features: { include: { feature: true } },
        _count: { select: { clients: true } },
      },
    });
  }

  async findOne(userId: string, id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        features: { include: { feature: true } },
      },
    });
    if (!plan) throw new NotFoundException(`Plan #${id} not found`);
    if (plan.userId !== userId) throw new ForbiddenException();
    return plan;
  }

  async update(userId: string, id: string, data: Partial<CreatePlanDto>) {
    await this.findOne(userId, id);

    const { featureIds, ...planData } = data;

    // If featureIds provided, replace all plan features atomically
    if (featureIds !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        await tx.planFeature.deleteMany({ where: { planId: id } });
        return tx.plan.update({
          where: { id },
          data: {
            ...planData,
            ...(featureIds.length && {
              features: {
                create: featureIds.map((featureId) => ({ featureId })),
              },
            }),
          },
          include: {
            features: { include: { feature: true } },
            _count: { select: { clients: true } },
          },
        });
      });
    }

    return this.prisma.plan.update({
      where: { id },
      data: planData,
      include: {
        features: { include: { feature: true } },
        _count: { select: { clients: true } },
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.plan.delete({ where: { id } });
  }

  async findPublicByTrainer(trainerId: string) {
    const plans = await this.prisma.plan.findMany({
      where: { userId: trainerId, active: true },
      select: {
        id: true,
        type: true,
        name: true,
        sessionsPerWeek: true,
        durationMinutes: true,
        price: true,
        features: {
          include: { feature: true },
          where: { feature: { isActive: true } },
        },
      },
    });

    const presencial = plans
      .filter((p) => p.type === 'PRESENCIAL')
      .map((p) => ({
        id: p.id,
        name: p.name,
        sessionsPerWeek: p.sessionsPerWeek,
        sessionsPerMonth: p.sessionsPerWeek * 4,
        durationMinutes: p.durationMinutes,
        price: p.price,
        features: p.features.map((pf) => ({
          key: pf.feature.key,
          name: pf.feature.name,
        })),
      }));

    const consultoria = plans
      .filter((p) => p.type === 'CONSULTORIA')
      .map((p) => ({
        id: p.id,
        name: p.name,
        sessionsPerWeek: p.sessionsPerWeek,
        price: p.price,
        features: p.features.map((pf) => ({
          key: pf.feature.key,
          name: pf.feature.name,
        })),
      }));

    return { presencial, consultoria };
  }
}
