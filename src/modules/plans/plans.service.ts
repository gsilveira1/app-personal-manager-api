import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './plans-create.dto';

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, data: CreatePlanDto) {
    return this.prisma.plan.create({ 
      data: { ...data, userId } 
    });
  }

  async findAll(userId: string) {
    return this.prisma.plan.findMany({
      where: { userId },
      include: {
        _count: { select: { clients: true } },
      },
    });
  }

  async findOne(userId: string, id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan #${id} not found`);
    if (plan.userId !== userId) throw new ForbiddenException();
    return plan;
  }

  async update(userId: string, id: string, data: Partial<CreatePlanDto>) {
    await this.findOne(userId, id);
    return this.prisma.plan.update({ where: { id }, data });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.plan.delete({ where: { id } });
  }
}