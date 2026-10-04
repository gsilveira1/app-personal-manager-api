import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PORTAL_TOKEN_AUDIENCE } from "../../../common/auth";
import {
  CLIENT_DIRECTORY,
  ClientDirectory,
  ClientSummary,
  NOTIFICATION_SENDER,
  NotificationSender,
  USER_DIRECTORY,
  UserDirectory,
} from "../../../common/ports";
import { buildIdempotencyKey } from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";
import { MagicLink, SendLinkResult } from "./portal.dto";

/** `action` claim that marks a student-portal token (never present on access tokens). */
export const WORKOUT_TOKEN_ACTION = "WORKOUT";
const WORKOUT_TOKEN_TTL = "30d";
const DEFAULT_FRONTEND_URL = "http://localhost:5173";
/** Length of "YYYY-MM-DDTHH:mm" in an ISO timestamp. */
const ISO_MINUTE_LENGTH = 16;

@Injectable()
export class MagicLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    @Inject(NOTIFICATION_SENDER)
    private readonly notifications: NotificationSender,
  ) {}

  /**
   * Issues the student-portal link of a client. Nothing is stored: the link is a JWT.
   *
   * @throws {NotFoundException | ForbiddenException} From the client ownership check
   *
   * @example
   * const { url } = await magicLinks.generate(userId, clientId);
   */
  async generate(userId: string, clientId: string): Promise<MagicLink> {
    const client = await this.clients.requireOwned(userId, clientId);
    return this.issue(client);
  }

  private async issue(client: ClientSummary): Promise<MagicLink> {
    const trainer = await this.users.getProfile(client.userId);
    const token = this.jwt.sign(
      {
        sub: client.id,
        clientId: client.id,
        userId: client.userId,
        slug: trainer.slug,
        theme: { primaryColor: trainer.primaryColor, logoUrl: trainer.logoUrl },
        action: WORKOUT_TOKEN_ACTION,
      },
      // The audience keeps this token out of JwtAuthGuard (it expects the session audience).
      { expiresIn: WORKOUT_TOKEN_TTL, audience: PORTAL_TOKEN_AUDIENCE },
    );
    return {
      token,
      url: `${this.frontendUrl()}/#/p/${trainer.slug}?token=${token}`,
    };
  }

  private frontendUrl(): string {
    const base =
      this.config.get<string>("FRONTEND_URL") ||
      this.config.get<string>("APP_CLIENT_URL") ||
      DEFAULT_FRONTEND_URL;
    return base.replace(/\/$/, "");
  }

  /**
   * Builds the link and queues it for WhatsApp delivery. Repeating the call within the
   * same UTC minute (for the same active sheet) does not queue a second message.
   *
   * @throws {NotFoundException | ForbiddenException} From the client ownership check
   * @throws {ServiceUnavailableException} When the queue cannot be reached
   *
   * @example
   * const { jobId, scheduledDelayMs } = await magicLinks.send(userId, clientId);
   */
  async send(userId: string, clientId: string): Promise<SendLinkResult> {
    const client = await this.clients.requireOwned(userId, clientId);
    const { url } = await this.issue(client);
    const activeSheet = await this.prisma.workoutSheet.findFirst({
      where: { clientId, active: true, isTemplate: false },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const utcMinute = new Date().toISOString().slice(0, ISO_MINUTE_LENGTH);
    const job = await this.notifications.enqueue({
      userId,
      clientId,
      recipientPhone: client.phone,
      templateType: "WORKOUT_LINK",
      params: { name: client.name, link: url },
      idempotencyKey: buildIdempotencyKey([
        "WORKOUT_LINK",
        clientId,
        activeSheet?.id ?? "none",
        utcMinute,
      ]),
    });
    return {
      status: "QUEUED",
      channel: "WHATSAPP",
      jobId: job.jobId,
      scheduledDelayMs: job.scheduledDelayMs,
      link: url,
      message: "Disparo adicionado à fila com sucesso.",
    };
  }
}
