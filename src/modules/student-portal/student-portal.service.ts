import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { CompleteStudentSessionDto } from "./dto/student-portal.dto";

@Injectable()
export class StudentPortalService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async generateWorkoutMagicLink(userId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { user: { include: { tenant: true } } },
    });

    if (!client || client.userId !== userId) {
      throw new ForbiddenException("Acesso negado");
    }

    const payload = {
      sub: client.id,
      clientId: client.id,
      userId: client.userId,
      tenantId: client.user.tenantId,
      slug: client.user.tenant?.slug || "portal",
      theme: {
        primaryColor: client.user.tenant?.primaryColor || "#10B981",
        logoUrl: client.user.tenant?.logoUrl || null,
      },
      action: "WORKOUT",
    };

    const baseUrl = (
      process.env.FRONTEND_URL ||
      process.env.APP_CLIENT_URL ||
      "http://localhost:5173"
    ).replace(/\/$/, "");

    const token = this.jwtService.sign(payload, { expiresIn: "30d" });
    const slug = client.user.tenant?.slug || "p";

    return {
      token,
      url: `${baseUrl}/#/p/${slug}?token=${token}`,
    };
  }

  async verifyStudentToken(token: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException("Token inválido ou expirado.");
    }

    if (payload.action !== "WORKOUT") {
      throw new ForbiddenException(
        "Token não autorizado para execução de treino.",
      );
    }

    const client = await this.prisma.client.findUnique({
      where: { id: payload.clientId },
      include: { user: { include: { tenant: true } } },
    });

    if (!client) {
      throw new NotFoundException("Aluno não encontrado.");
    }

    // Check Tenant Status (Feature 008 Guardrail)
    if (
      client.user.tenant &&
      (client.user.tenant.status === "BLOCKED" ||
        client.user.tenant.status === "OVERDUE")
    ) {
      throw new ForbiddenException(
        "Plataforma temporariamente indisponível. Por favor, contate seu treinador.",
      );
    }

    // Check Student Status (Feature 002 Guardrail)
    if (client.status === "PAUSED") {
      throw new ForbiddenException(
        "Seus treinos estão pausados no momento. Fale com seu treinador para retornar.",
      );
    }

    return { client, payload };
  }

  async getStudentActiveWorkoutSheet(token: string) {
    const { client } = await this.verifyStudentToken(token);

    const sheet = await this.prisma.workoutSheet.findFirst({
      where: { clientId: client.id, active: true },
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

    if (!sheet) {
      return {
        sheetId: null,
        sheetName: "Nenhuma ficha ativa",
        workouts: [],
      };
    }

    // Fetch last session loads to pre-populate lastLoadKg
    const lastSession = await this.prisma.studentSession.findFirst({
      where: { clientId: client.id },
      orderBy: { completedAt: "desc" },
    });

    const previousLoadsMap = new Map<string, number>();
    if (lastSession?.loads && Array.isArray(lastSession.loads)) {
      lastSession.loads.forEach((item: any) => {
        if (item.workoutExerciseId && typeof item.loadKg === "number") {
          previousLoadsMap.set(item.workoutExerciseId, item.loadKg);
        }
      });
    }

    return {
      sheetId: sheet.id,
      sheetName: sheet.name,
      trainerName: client.user?.name || "Personal Trainer",
      trainerPhone: client.user?.phone || "",
      workouts: sheet.workouts.map((w) => ({
        id: w.id,
        letter: w.letter,
        name: w.name,
        blocks: w.blocks.map((b) => ({
          id: b.id,
          type: b.type,
          restTimeSeconds: b.restTimeSeconds,
          exercises: b.exercises.map((e) => ({
            workoutExerciseId: e.id,
            exerciseName: e.exerciseName,
            gifUrl: e.gifUrl || "https://pub-r2.com/exercises/bench.gif",
            sets: e.sets,
            reps: e.reps,
            executionNotes: e.executionNotes,
            lastLoadKg: previousLoadsMap.get(e.id) ?? e.suggestedLoadKg ?? null,
          })),
        })),
      })),
    };
  }

  async recordStudentSession(token: string, dto: CompleteStudentSessionDto) {
    const { client } = await this.verifyStudentToken(token);

    // Look up workout name if workoutId provided
    let workoutName = "Treino Realizado";
    if (dto.workoutId) {
      const workoutItem = await this.prisma.workoutSheetItem.findUnique({
        where: { id: dto.workoutId },
      });
      if (workoutItem) {
        workoutName = `Treino ${workoutItem.letter} - ${workoutItem.name}`;
      }
    }

    const session = await this.prisma.studentSession.create({
      data: {
        clientId: client.id,
        workoutId: dto.workoutId,
        workoutName,
        durationSeconds: dto.durationSeconds,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date(),
        loads: dto.loads as any,
      },
    });

    return {
      message: "Treino finalizado com sucesso!",
      sessionId: session.id,
      durationSeconds: session.durationSeconds,
    };
  }
}
