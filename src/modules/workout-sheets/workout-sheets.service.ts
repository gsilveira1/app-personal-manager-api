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
        if (block.type === "BISET" && (!block.exercises || block.exercises.length < 2)) {
          throw new BadRequestException(
            `Bloco do tipo BISET no treino ${workout.letter} deve ter no mínimo 2 exercícios.`,
          );
        }
        if (block.type === "TRISET" && (!block.exercises || block.exercises.length < 3)) {
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
}
