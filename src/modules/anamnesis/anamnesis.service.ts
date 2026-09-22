import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { SubmitAnamnesisDto } from "./dto/anamnesis-submit.dto";

@Injectable()
export class AnamnesisService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async generateMagicLinkToken(userId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { user: { include: { tenant: true } } },
    });

    if (!client || client.userId !== userId) {
      throw new NotFoundException("Client not found");
    }

    const payload = {
      sub: client.id,
      clientId: client.id,
      userId: client.userId,
      tenantId: client.user.tenantId,
      action: "ANAMNESIS",
    };

    const token = this.jwtService.sign(payload, { expiresIn: "7d" });

    await this.prisma.anamnesis.create({
      data: {
        clientId: client.id,
        userId: client.userId,
        token,
        tokenUsed: false,
        isCurrent: false,
      },
    });

    const baseUrl = (
      process.env.FRONTEND_URL ||
      process.env.APP_CLIENT_URL ||
      "http://localhost:5173"
    ).replace(/\/$/, "");

    return { token, link: `${baseUrl}/#/anamnesis?token=${token}` };
  }

  async getFormMetadata(token: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired anamnesis token");
    }

    if (payload.action !== "ANAMNESIS") {
      throw new ForbiddenException(
        "Token is not valid for anamnesis submission",
      );
    }

    const anamnesisRecord = await this.prisma.anamnesis.findFirst({
      where: { token, tokenUsed: false },
    });

    if (!anamnesisRecord) {
      throw new BadRequestException(
        "Este link de anamnese já foi utilizado ou é inválido.",
      );
    }

    const client = await this.prisma.client.findUnique({
      where: { id: payload.clientId },
      include: {
        user: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException("Student not found");
    }

    return {
      studentName: client.name,
      personalName: client.user.name,
      theme: {
        primaryColor: client.user.tenant?.primaryColor || "#10B981",
        logoUrl: client.user.tenant?.logoUrl || null,
      },
    };
  }

  async submitAnamnesis(dto: SubmitAnamnesisDto) {
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.token);
    } catch {
      throw new UnauthorizedException("Invalid or expired anamnesis token");
    }

    if (payload.action !== "ANAMNESIS") {
      throw new ForbiddenException("Invalid token action");
    }

    const anamnesisDraft = await this.prisma.anamnesis.findFirst({
      where: { token: dto.token, tokenUsed: false },
    });

    if (!anamnesisDraft) {
      throw new BadRequestException(
        "Este formulário já foi enviado anteriormente.",
      );
    }

    // Mark previous anamneses as not current
    await this.prisma.anamnesis.updateMany({
      where: { clientId: payload.clientId, isCurrent: true },
      data: { isCurrent: false },
    });

    // Update draft with submitted answers and mark token used
    const savedAnamnesis = await this.prisma.anamnesis.update({
      where: { id: anamnesisDraft.id },
      data: {
        isCurrent: true,
        tokenUsed: true,
        medicalHistory: dto.medicalHistory,
        injuriesAndPain: dto.injuriesAndPain,
        routineAndSchedule: dto.routineAndSchedule,
        fitnessGoals: dto.fitnessGoals,
        experienceLevel: dto.experienceLevel,
        parqAnswers: dto.parqAnswers as any,
        frontPhotoUrl: dto.frontPhotoUrl,
        backPhotoUrl: dto.backPhotoUrl,
        sidePhotoUrl: dto.sidePhotoUrl,
        weightKg: dto.weightKg,
        measurements: dto.measurements as any,
      },
    });

    // Also update client medicalHistory and record evaluation if measurements / weight provided
    if (dto.weightKg || dto.measurements) {
      await this.prisma.evaluation.create({
        data: {
          clientId: payload.clientId,
          date: new Date(),
          weight: dto.weightKg || 70,
          perimeters: dto.measurements as any,
          notes: "Anamnese inicial preenchida pelo aluno",
        },
      });
    }

    return {
      message: "Anamnese enviada com sucesso!",
      id: savedAnamnesis.id,
    };
  }

  async getStudentAnamneses(userId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || client.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.prisma.anamnesis.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
    });
  }

  async requestReassessment(userId: string, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || client.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const { token, link } = await this.generateMagicLinkToken(userId, clientId);

    // Queue WhatsApp notification log
    await this.prisma.notificationLog.create({
      data: {
        recipientPhone: client.phone,
        templateType: "WELCOME_ANAMNESIS",
        status: "QUEUED",
        channel: "WHATSAPP",
      },
    });

    return {
      message:
        "Solicitação de reavaliação enfileirada no WhatsApp com sucesso.",
      token,
      link,
    };
  }
}
