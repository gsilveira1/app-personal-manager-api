import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AccountStatus, ClientStatus, WorkoutSheet } from "@prisma/client";
import { PORTAL_TOKEN_AUDIENCE } from "../../../common/auth";
import {
  CLIENT_DIRECTORY,
  ClientDirectory,
  ClientSummary,
  TrainerProfile,
  USER_DIRECTORY,
  UserDirectory,
} from "../../../common/ports";
import {
  buildExecutionData,
  findWorkoutItem,
  loadsByExercise,
  readExecutionData,
  readWorkoutStructure,
  toJsonValue,
  WorkoutItem,
} from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";
import { sortWorkoutItems } from "../sheets/sheet.view";
import { WORKOUT_TOKEN_ACTION } from "./magic-link.service";
import {
  CompleteStudentSessionDto,
  PortalSheet,
  PortalWorkout,
} from "./portal.dto";

const SUSPENDED_ACCOUNTS: readonly AccountStatus[] = [
  AccountStatus.BLOCKED,
  AccountStatus.OVERDUE,
];
/** Shown for exercises without a GIF (v1 behaviour, kept). */
const FALLBACK_GIF_URL = "https://pub-r2.com/exercises/bench.gif";
const GENERIC_WORKOUT_NAME = "Treino Realizado";

interface StudentContext {
  client: ClientSummary;
  trainer: TrainerProfile;
}

@Injectable()
export class StudentPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}

  /**
   * Portal token check, in the contract's order (6.3).
   *
   * @throws {UnauthorizedException} Token invalid or expired
   * @throws {ForbiddenException} Not a workout token; trainer BLOCKED/OVERDUE; student PAUSED
   * @throws {NotFoundException} Client missing or soft-deleted
   */
  private async authorize(token: string): Promise<StudentContext> {
    const clientId = this.readClientId(token);
    const client = await this.clients.findById(clientId);
    if (!client) throw new NotFoundException("Aluno não encontrado.");

    const trainer = await this.users.getProfile(client.userId);
    if (SUSPENDED_ACCOUNTS.includes(trainer.status)) {
      throw new ForbiddenException(
        "Plataforma temporariamente indisponível. Por favor, contate seu treinador.",
      );
    }
    if (client.status === ClientStatus.PAUSED) {
      throw new ForbiddenException(
        "Seus treinos estão pausados no momento. Fale com seu treinador para retornar.",
      );
    }
    return { client, trainer };
  }

  private readClientId(token: string): string {
    let payload: { action?: unknown; clientId?: unknown };
    try {
      payload = this.jwt.verify(token, { audience: PORTAL_TOKEN_AUDIENCE });
    } catch {
      // Any verification failure (signature, expiry, audience, malformed) is the caller's 401.
      throw new UnauthorizedException("Token inválido ou expirado.");
    }
    if (payload.action !== WORKOUT_TOKEN_ACTION) {
      throw new ForbiddenException(
        "Token não autorizado para execução de treino.",
      );
    }
    if (typeof payload.clientId !== "string" || !payload.clientId) {
      throw new UnauthorizedException("Token inválido ou expirado.");
    }
    return payload.clientId;
  }

  private findActiveSheet(clientId: string): Promise<WorkoutSheet | null> {
    return this.prisma.workoutSheet.findFirst({
      where: { clientId, active: true, isTemplate: false },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * The student's active sheet with `lastLoadKg` pre-filled from the latest session.
   *
   * @example
   * const sheet = await portal.getActiveSheet(token);
   */
  async getActiveSheet(token: string): Promise<PortalSheet> {
    const { client, trainer } = await this.authorize(token);
    const sheet = await this.findActiveSheet(client.id);
    if (!sheet) {
      return { sheetId: null, sheetName: "Nenhuma ficha ativa", workouts: [] };
    }
    const lastLoads = await this.findLastLoads(client.id);
    const { items } = readWorkoutStructure(sheet.structure, sheet.id);
    return {
      sheetId: sheet.id,
      sheetName: sheet.name,
      trainerName: trainer.name || "Personal Trainer",
      trainerPhone: trainer.phone ?? "",
      workouts: sortWorkoutItems(items).map((item) =>
        toPortalWorkout(item, lastLoads),
      ),
    };
  }

  private async findLastLoads(clientId: string): Promise<Map<string, number>> {
    const last = await this.prisma.studentSession.findFirst({
      where: { clientId },
      orderBy: { completedAt: "desc" },
    });
    if (!last) return new Map();
    return loadsByExercise(readExecutionData(last.executionData, last.id));
  }

  /**
   * Stores a finished workout. `workoutId` that is not an item of the active sheet is
   * still recorded, as a generic session without a sheet.
   *
   * @example
   * await portal.recordSession(token, { workoutId: "w-1", durationSeconds: 3000, loads });
   */
  async recordSession(token: string, dto: CompleteStudentSessionDto) {
    const { client } = await this.authorize(token);
    const sheet = await this.findActiveSheet(client.id);
    const item = sheet
      ? findWorkoutItem(
          readWorkoutStructure(sheet.structure, sheet.id),
          dto.workoutId,
        )
      : null;
    const executionData = buildExecutionData({
      sheetId: item && sheet ? sheet.id : null,
      itemId: dto.workoutId,
      loads: dto.loads,
    });
    const session = await this.prisma.studentSession.create({
      data: {
        clientId: client.id,
        workoutName: item
          ? `Treino ${item.letter} - ${item.name}`
          : GENERIC_WORKOUT_NAME,
        durationSeconds: dto.durationSeconds,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date(),
        executionData: toJsonValue(executionData),
      },
    });
    return {
      message: "Treino finalizado com sucesso!",
      sessionId: session.id,
      durationSeconds: session.durationSeconds,
    };
  }
}

function toPortalWorkout(
  item: WorkoutItem,
  lastLoads: Map<string, number>,
): PortalWorkout {
  return {
    id: item.id,
    letter: item.letter,
    name: item.name,
    blocks: item.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      restTimeSeconds: block.restTimeSeconds,
      exercises: block.exercises.map((exercise) => ({
        workoutExerciseId: exercise.id,
        exerciseName: exercise.exerciseName,
        gifUrl: exercise.gifUrl || FALLBACK_GIF_URL,
        sets: exercise.sets,
        reps: exercise.reps,
        executionNotes: exercise.executionNotes,
        lastLoadKg: lastLoads.get(exercise.id) ?? exercise.suggestedLoadKg,
      })),
    })),
  };
}
