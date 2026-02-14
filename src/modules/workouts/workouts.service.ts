import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkoutDto } from './workouts-create.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class WorkoutsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, data: CreateWorkoutDto) {
    const { exercises, ...rest } = data;
    const exercisesJson = exercises as unknown as Prisma.InputJsonValue[];

    return this.prisma.workoutPlan.create({
      data: {
        ...rest,
        userId, // Associa ao user
        exercises: exercisesJson,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.workoutPlan.findMany({
      where: { userId },
      include: {
        client: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const workout = await this.prisma.workoutPlan.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!workout) throw new NotFoundException(`Workout #${id} not found`);
    if (workout.userId !== userId) throw new ForbiddenException();
    return workout;
  }

  async update(userId: string, id: string, data: Partial<CreateWorkoutDto>) {
    await this.findOne(userId, id); // Checa permissão
    
    const { exercises, ...rest } = data;
    const updateData: any = { ...rest };
    
    if (exercises) {
      updateData.exercises = exercises as unknown as Prisma.InputJsonValue[];
    }

    return this.prisma.workoutPlan.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.workoutPlan.delete({ where: { id } });
  }
}