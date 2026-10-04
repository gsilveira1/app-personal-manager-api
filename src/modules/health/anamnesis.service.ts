import { randomBytes } from "crypto";
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Assessment, AssessmentType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AnamnesisRequester,
  AnamnesisRequestResult,
  CLIENT_DIRECTORY,
  ClientDirectory,
  ClientSummary,
  EnqueueNotificationResult,
  NOTIFICATION_SENDER,
  NotificationSender,
  USER_DIRECTORY,
  UserDirectory,
} from "../../common/ports";
import {
  AnamnesisData,
  buildAnamnesisData,
  buildIdempotencyKey,
  buildPhysicalEvaluationData,
  EMPTY_ANAMNESIS_DATA,
  Perimeters,
  PerimetersDto,
  toJsonValue,
} from "../../common/types";
import { SubmitAnamnesisDto } from "./dto/submit-anamnesis.dto";
import { AnamnesisView, toAnamnesisViews } from "./assessment.views";

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVALID_LINK_MESSAGE =
  "Link de anamnese inválido, expirado ou já utilizado.";
const SELF_REPORTED_NOTES = "Anamnese inicial preenchida pelo aluno";
const WELCOME_TEMPLATE = "WELCOME_ANAMNESIS";

/** Exhaustive over `PerimetersDto`: a key added there fails compilation here. */
const PERIMETER_KEY_MAP: Record<keyof PerimetersDto, true> = {
  waist: true,
  hip: true,
  chest: true,
  rightArm: true,
  leftArm: true,
  rightThigh: true,
  leftThigh: true,
  rightCalf: true,
  leftCalf: true,
  relaxedArm: true,
  flexedArm: true,
  forearm: true,
  abdomen: true,
  thigh: true,
  calf: true,
};
const PERIMETER_KEYS: ReadonlySet<string> = new Set(
  Object.keys(PERIMETER_KEY_MAP),
);

export interface AnamnesisFormMetadata {
  studentName: string;
  personalName: string;
  theme: { primaryColor: string; logoUrl: string | null };
}

export interface ReassessmentResponse {
  message: string;
  token: string;
  link: string;
  notification: { status: "QUEUED"; jobId: string; scheduledDelayMs: number };
}

function frontendBaseUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.APP_CLIENT_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
}

/** The entries of `measurements` whose key is a `PerimetersDto` key. */
export function perimetersFrom(
  measurements: Record<string, number> | undefined,
): Perimeters | undefined {
  const entries = Object.entries(measurements ?? {}).filter(([key]) =>
    PERIMETER_KEYS.has(key),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Anamneses: `Assessment` rows of type ANAMNESIS, filled by the student through an
 * opaque, single-use magic token.
 */
@Injectable()
export class AnamnesisService implements AnamnesisRequester {
  private readonly logger = new Logger(AnamnesisService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    @Inject(NOTIFICATION_SENDER)
    private readonly notifications: NotificationSender,
  ) {}

  /**
   * Creates a pending anamnesis with a magic token and, when `notify` is true, queues
   * the WhatsApp message carrying the link.
   *
   * @throws {NotFoundException} Client missing or soft-deleted
   * @throws {ForbiddenException} Client of another trainer
   * @throws {ServiceUnavailableException} `notify` is true and the queue is down (the
   *   assessment has already been created)
   */
  async requestAnamnesis(
    userId: string,
    clientId: string,
    options: { notify: boolean },
  ): Promise<AnamnesisRequestResult> {
    const client = await this.clients.requireOwned(userId, clientId);
    const token = randomBytes(32).toString("hex");
    const assessment = await this.prisma.assessment.create({
      data: {
        type: AssessmentType.ANAMNESIS,
        data: toJsonValue(EMPTY_ANAMNESIS_DATA),
        magicToken: token,
        tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        clientId: client.id,
        userId,
      },
    });
    const link = `${frontendBaseUrl()}/anamnesis?token=${token}`;
    const notification = options.notify
      ? await this.enqueueLink(userId, client, assessment.id, link)
      : null;
    return { assessmentId: assessment.id, token, link, notification };
  }

  /** `POST /anamnesis/student/:id/magic-link`: creates the link without sending it. */
  async createMagicLink(
    userId: string,
    clientId: string,
  ): Promise<{ token: string; link: string }> {
    const { token, link } = await this.requestAnamnesis(userId, clientId, {
      notify: false,
    });
    return { token, link };
  }

  /** `POST /anamnesis/student/:id/request-reassessment`: creates the link and sends it. */
  async requestReassessment(
    userId: string,
    clientId: string,
  ): Promise<ReassessmentResponse> {
    const result = await this.requestAnamnesis(userId, clientId, {
      notify: true,
    });
    const queued = result.notification as EnqueueNotificationResult;
    return {
      message:
        "Solicitação de reavaliação enfileirada no WhatsApp com sucesso.",
      token: result.token,
      link: result.link,
      notification: {
        status: "QUEUED",
        jobId: queued.jobId,
        scheduledDelayMs: queued.scheduledDelayMs,
      },
    };
  }

  /**
   * @throws {UnauthorizedException} Unknown, expired or already used token
   * @throws {NotFoundException} Client missing or soft-deleted
   */
  async getFormMetadata(
    token: string | undefined,
  ): Promise<AnamnesisFormMetadata> {
    const pending = await this.requirePending(token);
    const client = await this.requireLiveClient(pending.clientId);
    const trainer = await this.users.getProfile(pending.userId);
    return {
      studentName: client.name,
      personalName: trainer.name,
      theme: { primaryColor: trainer.primaryColor, logoUrl: trainer.logoUrl },
    };
  }

  /**
   * Stores the answers and consumes the token atomically: of two concurrent submissions
   * with the same token, exactly one succeeds.
   *
   * @throws {UnauthorizedException} Unknown, expired or already used token
   * @throws {NotFoundException} Client missing or soft-deleted
   * @throws {BadRequestException} Invalid answers
   */
  async submit(
    dto: SubmitAnamnesisDto,
  ): Promise<{ message: string; id: string }> {
    const { token, ...answers } = dto;
    const pending = await this.requirePending(token);
    await this.requireLiveClient(pending.clientId);
    const data = buildAnamnesisData(answers);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assessment.updateMany({
        where: { id: pending.id, magicToken: token },
        data: {
          data: toJsonValue(data),
          date: now,
          magicToken: null,
          tokenExpiresAt: null,
        },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException(INVALID_LINK_MESSAGE);
      }
      await this.createSelfReportedEvaluation(tx, pending, data, now);
    });

    return { message: "Anamnese enviada com sucesso!", id: pending.id };
  }

  /**
   * History of a client, newest first.
   *
   * @throws {NotFoundException} Client missing or soft-deleted
   * @throws {ForbiddenException} Client of another trainer
   */
  async listForClient(
    userId: string,
    clientId: string,
  ): Promise<AnamnesisView[]> {
    await this.clients.requireOwned(userId, clientId);
    const rows = await this.prisma.assessment.findMany({
      where: { clientId, userId, type: AssessmentType.ANAMNESIS },
      orderBy: { createdAt: "desc" },
    });
    return toAnamnesisViews(rows, new Date());
  }

  private async enqueueLink(
    userId: string,
    client: ClientSummary,
    assessmentId: string,
    link: string,
  ): Promise<EnqueueNotificationResult> {
    try {
      return await this.notifications.enqueue({
        userId,
        clientId: client.id,
        recipientPhone: client.phone,
        templateType: WELCOME_TEMPLATE,
        params: { name: client.name, link },
        idempotencyKey: buildIdempotencyKey([WELCOME_TEMPLATE, assessmentId]),
      });
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Anamnesis link not queued (assessmentId=${assessmentId}, clientId=${client.id}, userId=${userId}): ${cause.message}`,
        cause.stack,
      );
      throw error;
    }
  }

  private async requirePending(token: string | undefined): Promise<Assessment> {
    if (typeof token !== "string" || token.length === 0) {
      throw new UnauthorizedException(INVALID_LINK_MESSAGE);
    }
    const row = await this.prisma.assessment.findUnique({
      where: { magicToken: token },
    });
    const live =
      row !== null &&
      row.type === AssessmentType.ANAMNESIS &&
      row.tokenExpiresAt !== null &&
      row.tokenExpiresAt > new Date();
    if (!live) {
      throw new UnauthorizedException(INVALID_LINK_MESSAGE);
    }
    return row;
  }

  private async requireLiveClient(clientId: string): Promise<ClientSummary> {
    const client = await this.clients.findById(clientId);
    if (!client) {
      throw new NotFoundException("Aluno não encontrado.");
    }
    return client;
  }

  /** Only when the student reported a weight: v2 does not invent one (contract A13). */
  private async createSelfReportedEvaluation(
    tx: Prisma.TransactionClient,
    anamnesis: Pick<Assessment, "clientId" | "userId">,
    answers: AnamnesisData,
    now: Date,
  ): Promise<void> {
    if (answers.weightKg === undefined) return;
    const perimeters = perimetersFrom(answers.measurements);
    const data = buildPhysicalEvaluationData({
      weight: answers.weightKg,
      ...(perimeters ? { perimeters } : {}),
      notes: SELF_REPORTED_NOTES,
    });
    await tx.assessment.create({
      data: {
        type: AssessmentType.PHYSICAL_EVALUATION,
        data: toJsonValue(data),
        date: now,
        clientId: anamnesis.clientId,
        userId: anamnesis.userId,
      },
    });
  }
}
