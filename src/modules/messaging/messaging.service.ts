import { Injectable, ForbiddenException } from "@nestjs/common";
import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
import { PrismaService } from "../prisma/prisma.service";
import { AnamnesisService } from "../anamnesis/anamnesis.service";
import { StudentPortalService } from "../student-portal/student-portal.service";

export const SAO_PAULO_TZ = "America/Sao_Paulo";

@Injectable()
export class MessagingService {
  constructor(
    private prisma: PrismaService,
    private anamnesisService: AnamnesisService,
    private studentPortalService: StudentPortalService,
  ) {}

  /**
   * Calculates delay in milliseconds if the current time falls within DND window (22:00 to 08:00 America/Sao_Paulo).
   * If now is 23:00 or 02:30, delays execution until 08:00:00 of the upcoming morning.
   */
  calculateDndDelayMs(nowUtc: Date = new Date()): number {
    const zonedNow = utcToZonedTime(nowUtc, SAO_PAULO_TZ);
    const hour = zonedNow.getHours();

    // DND is between 22:00 (10 PM) and 08:00 (8 AM)
    const isDnd = hour >= 22 || hour < 8;

    if (!isDnd) {
      return 0; // Immediate execution allowed
    }

    // Determine target 08:00 AM in America/Sao_Paulo
    const targetZoned = new Date(zonedNow);
    if (hour >= 22) {
      // 08:00 AM next day
      targetZoned.setDate(targetZoned.getDate() + 1);
    }
    targetZoned.setHours(8, 0, 0, 0);

    const targetUtc = zonedTimeToUtc(targetZoned, SAO_PAULO_TZ);
    const delayMs = Math.max(0, targetUtc.getTime() - nowUtc.getTime());
    return delayMs;
  }

  formatMessage(
    templateType: "WELCOME_ANAMNESIS" | "WORKOUT_LINK" | "EXPIRATION_ALERT",
    params: { name: string; link?: string },
  ): string {
    switch (templateType) {
      case "WELCOME_ANAMNESIS":
        return `Olá, ${params.name}! Seja bem-vindo à minha consultoria fitness. Para começarmos, preencha sua anamnese de saúde aqui: ${params.link || ""}.`;
      case "WORKOUT_LINK":
        return `Fala, ${params.name}! Sua nova ficha de treinos está pronta. Acesse aqui: ${params.link || ""}.`;
      case "EXPIRATION_ALERT":
        return `Olá, ${params.name}! Sua ficha atual está chegando ao fim. Em breve enviarei sua nova periodização!`;
      default:
        return "";
    }
  }

  async resendLink(
    userId: string,
    clientId: string,
    type: "WORKOUT_SHEET" | "ANAMNESIS",
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { user: { include: { tenant: true } } },
    });

    if (!client || client.userId !== userId) {
      throw new ForbiddenException("Acesso negado a este aluno");
    }

    let link = "";
    let templateType: "WELCOME_ANAMNESIS" | "WORKOUT_LINK" = "WORKOUT_LINK";

    if (type === "ANAMNESIS") {
      const { link: anamnesisLink } =
        await this.anamnesisService.generateMagicLinkToken(userId, clientId);
      link = anamnesisLink;
      templateType = "WELCOME_ANAMNESIS";
    } else {
      const { url } = await this.studentPortalService.generateWorkoutMagicLink(
        userId,
        clientId,
      );
      link = url;
      templateType = "WORKOUT_LINK";
    }

    const delayMs = this.calculateDndDelayMs();
    const whatsappStatus = client.user.tenant?.whatsappStatus || "DISCONNECTED";

    let channel = "WHATSAPP";
    let status = "QUEUED";

    if (whatsappStatus === "DISCONNECTED") {
      // Fallback to Email (Feature 007 RN 4)
      channel = "EMAIL";
      status = "SENT";
    }

    await this.prisma.notificationLog.create({
      data: {
        tenantId: client.user.tenantId,
        recipientPhone: client.phone,
        templateType,
        status,
        channel,
        error:
          whatsappStatus === "DISCONNECTED"
            ? "WhatsApp instance disconnected. Sent via email fallback."
            : null,
      },
    });

    return {
      status: "QUEUED",
      message: "Disparo adicionado à fila com sucesso.",
      channel,
      scheduledDelayMs: delayMs,
      link,
    };
  }

  async getTenantQueue(
    userId: string,
    query: {
      status?: string;
      channel?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });

    if (!user || !user.tenantId) {
      return {
        items: [],
        total: 0,
        page: 1,
        totalPages: 1,
        summary: { totalQueued: 0, totalSent: 0, totalFailed: 0, totalCancelled: 0 },
      };
    }

    const tenantId = user.tenantId;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (query.status && query.status !== "ALL") {
      where.status = query.status.toUpperCase();
    }

    if (query.channel && query.channel !== "ALL") {
      where.channel = query.channel.toUpperCase();
    }

    if (query.search) {
      where.OR = [
        { recipientPhone: { contains: query.search, mode: "insensitive" } },
        { templateType: { contains: query.search, mode: "insensitive" } },
        { error: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [total, items, totalQueued, totalSent, totalFailed, totalCancelled] =
      await Promise.all([
        this.prisma.notificationLog.count({ where }),
        this.prisma.notificationLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.notificationLog.count({ where: { tenantId, status: "QUEUED" } }),
        this.prisma.notificationLog.count({ where: { tenantId, status: "SENT" } }),
        this.prisma.notificationLog.count({ where: { tenantId, status: "FAILED" } }),
        this.prisma.notificationLog.count({ where: { tenantId, status: "CANCELLED" } }),
      ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        totalQueued,
        totalSent,
        totalFailed,
        totalCancelled,
      },
    };
  }

  async getClientMessageHistory(userId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, userId: true, phone: true, tenantId: true },
    });

    if (!client || client.userId !== userId) {
      throw new ForbiddenException("Acesso negado a este aluno");
    }

    const messages = await this.prisma.notificationLog.findMany({
      where: {
        recipientPhone: client.phone,
        ...(client.tenantId ? { tenantId: client.tenantId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return messages;
  }

  async retryNotification(userId: string, logId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    const log = await this.prisma.notificationLog.findUnique({
      where: { id: logId },
    });

    if (!log || (user?.tenantId && log.tenantId !== user.tenantId)) {
      throw new ForbiddenException("Notificação não encontrada ou acesso negado");
    }

    const whatsappStatus = user?.tenant?.whatsappStatus || "DISCONNECTED";
    let channel = "WHATSAPP";
    let status = "SENT";
    let error: string | null = null;

    if (whatsappStatus === "DISCONNECTED") {
      channel = "EMAIL";
      status = "SENT";
      error = "WhatsApp instance disconnected. Sent via email fallback.";
    }

    const updated = await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status,
        channel,
        error,
        updatedAt: new Date(),
      },
    });

    return {
      message: "Mensagem reenviada com sucesso.",
      notification: updated,
    };
  }

  async cancelNotification(userId: string, logId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const log = await this.prisma.notificationLog.findUnique({
      where: { id: logId },
    });

    if (!log || (user?.tenantId && log.tenantId !== user.tenantId)) {
      throw new ForbiddenException("Notificação não encontrada ou acesso negado");
    }

    const updated = await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status: "CANCELLED",
        error: "Cancelado manualmente pelo treinador.",
        updatedAt: new Date(),
      },
    });

    return {
      message: "Mensagem cancelada com sucesso.",
      notification: updated,
    };
  }
}

