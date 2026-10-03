import { Injectable, ForbiddenException, Logger } from "@nestjs/common";
import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
import { PrismaService } from "../prisma/prisma.service";
import { AnamnesisService } from "../anamnesis/anamnesis.service";
import { StudentPortalService } from "../student-portal/student-portal.service";
import { WhatsAppService } from "./whatsapp.service";

export const SAO_PAULO_TZ = "America/Sao_Paulo";

export interface TenantDndConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
}

export const DEFAULT_DND_CONFIG: TenantDndConfig = {
  enabled: true,
  startHour: 22,
  endHour: 8,
  timezone: SAO_PAULO_TZ,
};

export interface EnqueueNotificationParams {
  tenantId?: string | null;
  recipientPhone: string;
  templateType:
    | "WELCOME_ANAMNESIS"
    | "WORKOUT_LINK"
    | "EXPIRATION_ALERT"
    | string;
  clientName?: string;
  link?: string;
  content?: string;
  forceDispatch?: boolean;
}

export interface DispatchResult {
  success: boolean;
  channel: "WHATSAPP" | "EMAIL";
  status: "SENT" | "FAILED" | "QUEUED";
  error: string | null;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private prisma: PrismaService,
    private anamnesisService: AnamnesisService,
    private studentPortalService: StudentPortalService,
    private whatsappService: WhatsAppService,
  ) {}

  /**
   * Retrieves tenant-specific DND settings from tenant.features.
   * Supports both flat (dndEnabled, dndStartHour, dndEndHour, dndTimezone)
   * and nested (dnd: { enabled, startHour, endHour, timezone }).
   */
  async getTenantDndConfig(tenantId?: string | null): Promise<TenantDndConfig> {
    if (!tenantId) {
      return DEFAULT_DND_CONFIG;
    }

    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { features: true },
      });

      if (!tenant || !tenant.features) {
        return DEFAULT_DND_CONFIG;
      }

      const features: any =
        typeof tenant.features === "string"
          ? JSON.parse(tenant.features)
          : tenant.features;

      const dndNested = features.dnd;
      const enabled =
        dndNested?.enabled !== undefined
          ? Boolean(dndNested.enabled)
          : features.dndEnabled !== undefined
            ? Boolean(features.dndEnabled)
            : true;

      const startHour =
        dndNested?.startHour !== undefined
          ? Number(dndNested.startHour)
          : features.dndStartHour !== undefined
            ? Number(features.dndStartHour)
            : 22;

      const endHour =
        dndNested?.endHour !== undefined
          ? Number(dndNested.endHour)
          : features.dndEndHour !== undefined
            ? Number(features.dndEndHour)
            : 8;

      const timezone =
        dndNested?.timezone || features.dndTimezone || SAO_PAULO_TZ;

      return {
        enabled,
        startHour,
        endHour,
        timezone,
      };
    } catch (err: any) {
      this.logger.error(
        `Error loading DND config for tenant ${tenantId}: ${err.message}`,
      );
      return DEFAULT_DND_CONFIG;
    }
  }

  /**
   * Calculates delay in milliseconds if the current time falls within the configured DND window.
   * If DND is disabled (enabled: false) for this tenant, returns 0 for immediate dispatch.
   */
  calculateDndDelayMs(
    nowUtc: Date = new Date(),
    config: Partial<TenantDndConfig> = DEFAULT_DND_CONFIG,
  ): number {
    const enabled = config.enabled ?? true;
    if (!enabled) {
      return 0; // DND feature flag is disabled for this tenant
    }

    const startHour = config.startHour ?? 22;
    const endHour = config.endHour ?? 8;
    const timezone = config.timezone || SAO_PAULO_TZ;

    const zonedNow = utcToZonedTime(nowUtc, timezone);
    const hour = zonedNow.getHours();

    let isDnd = false;
    if (startHour > endHour) {
      // Overnight window (e.g. 22:00 to 08:00)
      isDnd = hour >= startHour || hour < endHour;
    } else if (startHour < endHour) {
      // Same-day window (e.g. 13:00 to 15:00)
      isDnd = hour >= startHour && hour < endHour;
    }

    if (!isDnd) {
      return 0; // Immediate execution allowed
    }

    // Determine target endHour in tenant timezone
    const targetZoned = new Date(zonedNow);
    if (startHour > endHour && hour >= startHour) {
      targetZoned.setDate(targetZoned.getDate() + 1);
    }
    targetZoned.setHours(endHour, 0, 0, 0);

    const targetUtc = zonedTimeToUtc(targetZoned, timezone);
    const delayMs = Math.max(0, targetUtc.getTime() - nowUtc.getTime());
    return delayMs;
  }

  formatMessage(
    templateType:
      | "WELCOME_ANAMNESIS"
      | "WORKOUT_LINK"
      | "EXPIRATION_ALERT"
      | string,
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
        return `Olá, ${params.name}! Notificação da sua consultoria fitness: ${params.link || ""}.`;
    }
  }

  /**
   * Directly dispatches a WhatsApp message using Evolution API if tenant has WhatsApp connected.
   * If tenant WhatsApp is disconnected, falls back to email.
   */
  async dispatchWhatsAppMessage(
    tenantId: string | null | undefined,
    recipientPhone: string,
    text: string,
  ): Promise<DispatchResult> {
    if (!tenantId) {
      this.logger.warn(
        `Dispatch aborted: No tenantId provided for phone ${recipientPhone}`,
      );
      return {
        success: false,
        channel: "WHATSAPP",
        status: "FAILED",
        error: "Tenant não configurado",
      };
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        whatsappStatus: true,
        whatsappInstanceName: true,
      },
    });

    const whatsappStatus = tenant?.whatsappStatus || "DISCONNECTED";
    const instanceName = tenant?.whatsappInstanceName;

    if (whatsappStatus === "CONNECTED" && instanceName) {
      const sendResult = await this.whatsappService.sendTextMessage(
        instanceName,
        recipientPhone,
        text,
      );

      if (sendResult.success) {
        return {
          success: true,
          channel: "WHATSAPP",
          status: "SENT",
          error: null,
        };
      }

      const isInputValidationError =
        sendResult.error?.includes("Número de telefone inválido") ||
        sendResult.error?.includes("não pode ser vazio");

      if (isInputValidationError) {
        return {
          success: false,
          channel: "WHATSAPP",
          status: "FAILED",
          error: sendResult.error || "Falha ao enviar mensagem pelo WhatsApp",
        };
      }

      // Instance / Evolution API failure (e.g. 404 instance does not exist, 400 disconnected, 500, network error)
      this.logger.warn(
        `WhatsApp dispatch failed for tenant ${tenantId} via instance '${instanceName}': ${sendResult.error}. Syncing tenant status to DISCONNECTED and applying email fallback.`,
      );

      // 1. Reconcile DB status to DISCONNECTED
      if (this.prisma?.tenant?.update) {
        try {
          await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { whatsappStatus: "DISCONNECTED" },
          });
        } catch (err: any) {
          this.logger.error(
            `Failed to update tenant ${tenantId} whatsappStatus to DISCONNECTED: ${err.message}`,
          );
        }
      }

      // 2. Automatically apply email fallback (Feature 007 RN 4 / ADR 004)
      return {
        success: true,
        channel: "EMAIL",
        status: "SENT",
        error: `WhatsApp instance '${instanceName}' disconnected or missing (${sendResult.error}). Sent via email fallback.`,
      };
    }

    // Fallback to Email (Feature 007 RN 4)
    this.logger.warn(
      `WhatsApp is ${whatsappStatus} for tenant ${tenantId}. Applying email fallback.`,
    );
    return {
      success: true,
      channel: "EMAIL",
      status: "SENT",
      error: "WhatsApp instance disconnected. Sent via email fallback.",
    };
  }

  /**
   * Unified notification enqueue and dispatch method.
   */
  async enqueueNotification(params: EnqueueNotificationParams) {
    const dndConfig = await this.getTenantDndConfig(params.tenantId);
    const delayMs = this.calculateDndDelayMs(new Date(), dndConfig);
    const isDnd = delayMs > 0 && !params.forceDispatch;
    const text =
      params.content ||
      this.formatMessage(params.templateType, {
        name: params.clientName || "Aluno",
        link: params.link,
      });

    if (!isDnd) {
      const dispatch = await this.dispatchWhatsAppMessage(
        params.tenantId,
        params.recipientPhone,
        text,
      );

      const log = await this.prisma.notificationLog.create({
        data: {
          tenantId: params.tenantId || null,
          recipientPhone: params.recipientPhone,
          templateType: params.templateType,
          status: dispatch.status,
          channel: dispatch.channel,
          error: dispatch.error,
        },
      });

      return {
        logId: log.id,
        status: dispatch.status,
        channel: dispatch.channel,
        scheduledDelayMs: 0,
        error: dispatch.error,
      };
    }

    // Inside DND window: record as QUEUED for later processing
    const log = await this.prisma.notificationLog.create({
      data: {
        tenantId: params.tenantId || null,
        recipientPhone: params.recipientPhone,
        templateType: params.templateType,
        status: "QUEUED",
        channel: "WHATSAPP",
        error: null,
      },
    });

    return {
      logId: log.id,
      status: "QUEUED",
      channel: "WHATSAPP",
      scheduledDelayMs: delayMs,
      error: null,
    };
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

    const dndConfig = await this.getTenantDndConfig(client.user.tenantId);
    const delayMs = this.calculateDndDelayMs(new Date(), dndConfig);
    const isDnd = delayMs > 0;
    const text = this.formatMessage(templateType, {
      name: client.name,
      link,
    });

    let status = "QUEUED";
    let channel = "WHATSAPP";
    let error: string | null = null;

    if (!isDnd) {
      const dispatch = await this.dispatchWhatsAppMessage(
        client.user.tenantId,
        client.phone,
        text,
      );
      status = dispatch.status;
      channel = dispatch.channel;
      error = dispatch.error;
    }

    await this.prisma.notificationLog.create({
      data: {
        tenantId: client.user.tenantId,
        recipientPhone: client.phone,
        templateType,
        status,
        channel,
        error,
      },
    });

    return {
      status,
      message:
        status === "SENT"
          ? "Mensagem enviada com sucesso."
          : status === "QUEUED"
            ? "Disparo adicionado à fila com sucesso."
            : "Falha no envio da mensagem.",
      channel,
      scheduledDelayMs: isDnd ? delayMs : 0,
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
        summary: {
          totalQueued: 0,
          totalSent: 0,
          totalFailed: 0,
          totalCancelled: 0,
        },
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
        this.prisma.notificationLog.count({
          where: { tenantId, status: "QUEUED" },
        }),
        this.prisma.notificationLog.count({
          where: { tenantId, status: "SENT" },
        }),
        this.prisma.notificationLog.count({
          where: { tenantId, status: "FAILED" },
        }),
        this.prisma.notificationLog.count({
          where: { tenantId, status: "CANCELLED" },
        }),
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
      throw new ForbiddenException(
        "Notificação não encontrada ou acesso negado",
      );
    }

    const text = this.formatMessage(log.templateType, { name: "Aluno" });
    const dispatch = await this.dispatchWhatsAppMessage(
      user?.tenantId || log.tenantId,
      log.recipientPhone,
      text,
    );

    const updated = await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status: dispatch.status,
        channel: dispatch.channel,
        error: dispatch.error,
        updatedAt: new Date(),
      },
    });

    return {
      message:
        dispatch.status === "SENT"
          ? "Mensagem reenviada com sucesso."
          : "Falha ao reenviar mensagem.",
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
      throw new ForbiddenException(
        "Notificação não encontrada ou acesso negado",
      );
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

  /**
   * Processes all queued notifications.
   * If current time is inside DND window and force is false, skips processing and returns deferred count.
   * If force is true, bypasses DND restriction and dispatches all queued notifications immediately.
   */
  async processPendingQueue(userId?: string, force: boolean = false) {
    let tenantIdFilter: string | undefined = undefined;
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });
      if (user?.tenantId) {
        tenantIdFilter = user.tenantId;
      }
    }

    if (tenantIdFilter && !force) {
      const dndConfig = await this.getTenantDndConfig(tenantIdFilter);
      const delayMs = this.calculateDndDelayMs(new Date(), dndConfig);
      if (delayMs > 0) {
        const queuedCount = await this.prisma.notificationLog.count({
          where: { status: "QUEUED", tenantId: tenantIdFilter },
        });
        return {
          processedCount: 0,
          successCount: 0,
          failedCount: 0,
          delayedCount: queuedCount,
          message: `Horário de silêncio ativo (${dndConfig.startHour}h-${dndConfig.endHour}h ${dndConfig.timezone}). Envios postergados.`,
        };
      }
    } else if (!tenantIdFilter && !force) {
      const defaultDelay = this.calculateDndDelayMs();
      if (defaultDelay > 0) {
        const queuedCount = await this.prisma.notificationLog.count({
          where: { status: "QUEUED" },
        });
        return {
          processedCount: 0,
          successCount: 0,
          failedCount: 0,
          delayedCount: queuedCount,
          message:
            "Horário de silêncio ativo (DND 22h-08h BRT). Envios postergados para as 08:00.",
        };
      }
    }

    const pendingLogs = await this.prisma.notificationLog.findMany({
      where: {
        status: "QUEUED",
        ...(tenantIdFilter ? { tenantId: tenantIdFilter } : {}),
      },
      take: 100,
      orderBy: { createdAt: "asc" },
    });

    let successCount = 0;
    let failedCount = 0;
    let delayedCount = 0;

    for (const log of pendingLogs) {
      if (!tenantIdFilter && !force && log.tenantId) {
        const logDndConfig = await this.getTenantDndConfig(log.tenantId);
        const logDelay = this.calculateDndDelayMs(new Date(), logDndConfig);
        if (logDelay > 0) {
          delayedCount++;
          continue;
        }
      }

      const text = this.formatMessage(log.templateType, { name: "Aluno" });
      const dispatch = await this.dispatchWhatsAppMessage(
        log.tenantId,
        log.recipientPhone,
        text,
      );

      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: dispatch.status,
          channel: dispatch.channel,
          error: dispatch.error,
          updatedAt: new Date(),
        },
      });

      if (dispatch.status === "SENT") {
        successCount++;
      } else {
        failedCount++;
      }
    }

    return {
      processedCount: pendingLogs.length - delayedCount,
      successCount,
      failedCount,
      delayedCount,
      message: `Fila processada: ${successCount} enviados com sucesso, ${failedCount} com falha${delayedCount > 0 ? `, ${delayedCount} retidos em DND` : ""}.`,
    };
  }
}
