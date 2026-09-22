import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateWorkoutSheetDto,
  SaveWorkoutTemplateDto,
} from "./dto/workout-sheet.dto";

@Injectable()
export class WorkoutSheetsService {
  constructor(private prisma: PrismaService) {}

  async createForStudent(
    userId: string,
    clientId: string,
    dto: CreateWorkoutSheetDto,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || client.userId !== userId) {
      throw new ForbiddenException("Acesso negado a este aluno");
    }

    // Validation Guardrail: Check BISET and TRISET block sizes
    for (const workout of dto.workouts) {
      for (const block of workout.blocks) {
        if (
          block.type === "BISET" &&
          (!block.exercises || block.exercises.length < 2)
        ) {
          throw new BadRequestException(
            `Bloco do tipo BISET no treino ${workout.letter} deve ter no mínimo 2 exercícios.`,
          );
        }
        if (
          block.type === "TRISET" &&
          (!block.exercises || block.exercises.length < 3)
        ) {
          throw new BadRequestException(
            `Bloco do tipo TRISET no treino ${workout.letter} deve ter no mínimo 3 exercícios.`,
          );
        }
      }
    }

    // Atomic transaction for sheet and sub-items
    return this.prisma.$transaction(async (tx) => {
      // Inactivate existing active sheets for this student
      await tx.workoutSheet.updateMany({
        where: { clientId, active: true },
        data: { active: false },
      });

      const sheet = await tx.workoutSheet.create({
        data: {
          name: dto.name,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          active: true,
          clientId,
          userId,
        },
      });

      for (let wIdx = 0; wIdx < dto.workouts.length; wIdx++) {
        const w = dto.workouts[wIdx];
        const workoutItem = await tx.workoutSheetItem.create({
          data: {
            sheetId: sheet.id,
            letter: w.letter,
            name: w.name,
            orderIndex: w.orderIndex ?? wIdx,
          },
        });

        for (let bIdx = 0; bIdx < w.blocks.length; bIdx++) {
          const b = w.blocks[bIdx];
          const block = await tx.workoutBlock.create({
            data: {
              workoutId: workoutItem.id,
              type: b.type,
              orderIndex: b.orderIndex ?? bIdx,
              restTimeSeconds: b.restTimeSeconds ?? 60,
            },
          });

          for (let eIdx = 0; eIdx < b.exercises.length; eIdx++) {
            const e = b.exercises[eIdx];
            await tx.workoutExercise.create({
              data: {
                blockId: block.id,
                exerciseId: e.exerciseId,
                exerciseName: e.exerciseName || "Exercício",
                gifUrl: e.gifUrl,
                sets: e.sets ?? 3,
                reps: e.reps ?? "10-12",
                suggestedLoadKg: e.suggestedLoadKg,
                executionNotes: e.executionNotes,
                orderIndex: e.orderIndex ?? eIdx,
              },
            });
          }
        }
      }

      return tx.workoutSheet.findUnique({
        where: { id: sheet.id },
        include: {
          workouts: {
            include: {
              blocks: {
                include: {
                  exercises: true,
                },
              },
            },
          },
        },
      });
    });
  }

  async findByStudent(userId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || client.userId !== userId) {
      throw new ForbiddenException("Acesso negado a este aluno");
    }

    return this.prisma.workoutSheet.findMany({
      where: { clientId },
      include: {
        workouts: {
          orderBy: { orderIndex: "asc" },
          include: {
            blocks: {
              orderBy: { orderIndex: "asc" },
              include: {
                exercises: {
                  orderBy: { orderIndex: "asc" },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(userId: string, id: string) {
    const sheet = await this.prisma.workoutSheet.findUnique({
      where: { id },
      include: {
        workouts: {
          orderBy: { orderIndex: "asc" },
          include: {
            blocks: {
              orderBy: { orderIndex: "asc" },
              include: {
                exercises: {
                  orderBy: { orderIndex: "asc" },
                },
              },
            },
          },
        },
      },
    });

    if (!sheet) {
      throw new NotFoundException(`Ficha #${id} não encontrada`);
    }

    if (sheet.userId !== userId) {
      throw new ForbiddenException("Acesso negado");
    }

    return sheet;
  }

  async saveAsTemplate(
    userId: string,
    sheetId: string,
    dto: SaveWorkoutTemplateDto,
  ) {
    const sheet = await this.findOne(userId, sheetId);

    return this.prisma.workoutTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        structure: sheet as any,
        userId,
      },
    });
  }

  async findTemplates(userId: string) {
    return this.prisma.workoutTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  private mapTemplateToWorkoutPlan(t: any) {
    const structure = t.structure || {};
    let exercises: any[] = [];
    if (Array.isArray(structure.exercises)) {
      exercises = structure.exercises;
    } else if (Array.isArray(structure.workouts)) {
      exercises = structure.workouts.flatMap((w: any) =>
        (w.blocks || []).flatMap((b: any) =>
          (b.exercises || []).map((e: any) => ({
            name: e.exerciseName || e.name || "Exercício",
            sets: e.sets || 3,
            reps: e.reps || "10-12",
            weight: e.suggestedLoadKg ? `${e.suggestedLoadKg}kg` : undefined,
            notes: e.executionNotes,
          })),
        ),
      );
    }

    return {
      id: t.id,
      title: t.name,
      description: t.description || "",
      exercises,
      tags: structure.tags || [],
      createdAt: t.createdAt
        ? typeof t.createdAt === "string"
          ? t.createdAt
          : t.createdAt.toISOString()
        : new Date().toISOString(),
    };
  }

  async findAllWorkouts(userId: string) {
    const templates = await this.prisma.workoutTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return templates.map((t) => this.mapTemplateToWorkoutPlan(t));
  }

  async findOneWorkout(userId: string, id: string) {
    const template = await this.prisma.workoutTemplate.findUnique({
      where: { id },
    });
    if (!template || template.userId !== userId) {
      throw new NotFoundException(`Workout #${id} não encontrado`);
    }
    return this.mapTemplateToWorkoutPlan(template);
  }

  async createWorkout(userId: string, data: any) {
    const template = await this.prisma.workoutTemplate.create({
      data: {
        name: data.title || data.name || "Novo Treino",
        description: data.description || "",
        structure: {
          exercises: data.exercises || [],
          tags: data.tags || [],
        },
        userId,
      },
    });
    return this.mapTemplateToWorkoutPlan(template);
  }

  async updateWorkout(userId: string, id: string, data: any) {
    await this.findOneWorkout(userId, id);
    const existing = await this.prisma.workoutTemplate.findUnique({
      where: { id },
    });
    const currentStructure: any = existing?.structure || {};
    const newStructure = {
      ...currentStructure,
      ...(data.exercises !== undefined ? { exercises: data.exercises } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
    };

    const updated = await this.prisma.workoutTemplate.update({
      where: { id },
      data: {
        ...(data.title ? { name: data.title } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        structure: newStructure,
      },
    });
    return this.mapTemplateToWorkoutPlan(updated);
  }

  async deleteWorkout(userId: string, id: string) {
    await this.findOneWorkout(userId, id);
    await this.prisma.workoutTemplate.delete({ where: { id } });
    return { message: "Workout excluído com sucesso" };
  }
}
