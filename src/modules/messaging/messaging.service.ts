import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
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
      const { url } =
        await this.studentPortalService.generateWorkoutMagicLink(userId, clientId);
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
}
