import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { GcsService } from "../gcs/gcs.service";
import { CreateClientDto } from "./clients-create.dto";
import { UpdateClientDto } from "./clients-update.dto";

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private gcs: GcsService,
  ) {}

  async create(userId: string, data: CreateClientDto) {
    try {
      const medicalHistoryInput = data.medicalHistory
        ? (data.medicalHistory as unknown as Prisma.InputJsonValue)
        : undefined;

      const phone = data.whatsapp || data.phone || "";
      const modality = data.modality || (data.type === "In-Person" ? "PRESENCIAL" : "ONLINE");
      const type = data.type || (modality === "PRESENCIAL" ? "In-Person" : "Online");

      const client = await this.prisma.client.create({
        data: {
          ...data,
          phone,
          modality,
          type,
          subscriptionStatus: "ACTIVE",
          medicalHistory: medicalHistoryInput,
          userId, // Associa ao utilizador logado
        },
      });

      if (phone) {
        await this.prisma.notificationLog.create({
          data: {
            recipientPhone: phone,
            templateType: "WELCOME_ANAMNESIS",
            status: "QUEUED",
            channel: "WHATSAPP",
          },
        }).catch(() => null);
      }

      return client;
    } catch (error: any) {
      if (error.code === "P2002") {
        throw new ConflictException("Email already exists");
      }
      throw error;
    }
  }

  async findAll(userId: string) {
    return this.prisma.client.findMany({
      where: { userId }, // Filtra apenas clientes deste utilizador
      include: {
        plan: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async findStudents(userId: string, query: { page?: number; limit?: number; search?: string; modality?: string; status?: string }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ClientWhereInput = {
      userId,
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
      ];
    }

    if (query.modality) {
      where.modality = query.modality;
    }

    if (query.status) {
      if (query.status.toUpperCase() === "PAUSED") {
        where.subscriptionStatus = "PAUSED";
      } else if (query.status.toUpperCase() === "ACTIVE") {
        where.status = "Active";
      } else if (query.status.toUpperCase() === "INACTIVE") {
        where.status = "Inactive";
      }
    }

    const [total, clients] = await Promise.all([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        include: {
          plan: { select: { name: true } },
          workoutSheets: {
            where: { active: true },
            take: 1,
            select: { id: true, name: true, expiresAt: true },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const items = clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      whatsapp: c.phone,
      phone: c.phone,
      modality: c.modality || (c.type === "In-Person" ? "PRESENCIAL" : "ONLINE"),
      status: c.subscriptionStatus === "PAUSED" ? "PAUSED" : (c.status.toUpperCase()),
      subscription: {
        status: c.subscriptionStatus || "ACTIVE",
        currentPeriodEnd: c.currentPeriodEnd,
        planName: c.plan?.name || "Plano Padrão",
      },
      activeWorkoutSheet: c.workoutSheets[0] || null,
    }));

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findOne(userId: string, id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        plan: true,
        workouts: true,
        workoutSheets: {
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
        },
        manualPayments: {
          orderBy: { createdAt: "desc" },
        },
        anamneses: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!client) {
      throw new NotFoundException(`Client #${id} not found`);
    }

    // Verificação de Segurança
    if (client.userId !== userId) {
      throw new ForbiddenException("Acesso negado a este cliente");
    }

    return client;
  }

  async update(userId: string, id: string, data: UpdateClientDto) {
    await this.findOne(userId, id); // Garante existência e permissão

    const medicalHistoryInput = data.medicalHistory
      ? (data.medicalHistory as unknown as Prisma.InputJsonValue)
      : undefined;

    return this.prisma.client.update({
      where: { id },
      data: {
        ...data,
        medicalHistory: medicalHistoryInput,
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id); // Garante existência e permissão
    return this.prisma.client.delete({
      where: { id },
    });
  }

  async recordManualPayment(
    userId: string,
    clientId: string,
    dto: { paymentType: string; validUntil: string; notes?: string; amount?: number },
  ) {
    await this.findOne(userId, clientId);
    const validUntilDate = new Date(dto.validUntil);

    const [payment, updatedClient] = await this.prisma.$transaction([
      this.prisma.manualPayment.create({
        data: {
          clientId,
          userId,
          paymentType: dto.paymentType,
          validUntil: validUntilDate,
          notes: dto.notes,
          amount: dto.amount,
        },
      }),
      this.prisma.client.update({
        where: { id: clientId },
        data: {
          status: "Active",
          subscriptionStatus: "ACTIVE",
          currentPeriodEnd: validUntilDate,
        },
      }),
    ]);

    return {
      message: "Pagamento manual registrado com sucesso",
      payment,
      client: updatedClient,
    };
  }

  async updateStudentStatus(userId: string, clientId: string, status: string) {
    await this.findOne(userId, clientId);
    const normalizedStatus = status.toUpperCase();

    const clientStatus = normalizedStatus === "INACTIVE" ? "Inactive" : "Active";
    const subscriptionStatus = normalizedStatus === "PAUSED" ? "PAUSED" : (normalizedStatus === "INACTIVE" ? "OVERDUE" : "ACTIVE");

    return this.prisma.client.update({
      where: { id: clientId },
      data: {
        status: clientStatus,
        subscriptionStatus,
      },
    });
  }

  async exportCsv(userId: string): Promise<string> {
    const clients = await this.prisma.client.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });

    const headers = "Nome,Telefone,Email,Modalidade,Status,VencimentoAssinatura\n";
    const rows = clients
      .map((c) => {
        const modality = c.modality || (c.type === "In-Person" ? "PRESENCIAL" : "ONLINE");
        const status = c.subscriptionStatus === "PAUSED" ? "PAUSED" : c.status;
        const expiry = c.currentPeriodEnd ? c.currentPeriodEnd.toISOString().split("T")[0] : "N/A";
        return `"${c.name}","${c.phone}","${c.email}","${modality}","${status}","${expiry}"`;
      })
      .join("\n");

    return headers + rows;
  }

  async getActivityHeatmap(userId: string, clientId: string, days: number = 30) {
    await this.findOne(userId, clientId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const sessions = await this.prisma.studentSession.findMany({
      where: {
        clientId,
        completedAt: { gte: startDate },
      },
      orderBy: { completedAt: "asc" },
    });

    const sessionByDateMap = new Map<string, { workoutName?: string; durationMinutes: number }>();
    sessions.forEach((s) => {
      const dateKey = s.completedAt.toISOString().split("T")[0];
      sessionByDateMap.set(dateKey, {
        workoutName: s.workoutName || "Treino Realizado",
        durationMinutes: Math.round(s.durationSeconds / 60),
      });
    });

    const daysList: Array<{ date: string; status: "COMPLETED" | "EXPIRED" | "NO_ACTIVITY"; workoutName?: string; durationMinutes?: number }> = [];
    let currentStreak = 0;
    let tempStreak = 0;
    let totalCompletedMonth = 0;
    let lastWorkoutDate: string | null = null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split("T")[0];

      if (sessionByDateMap.has(dateKey)) {
        const info = sessionByDateMap.get(dateKey)!;
        daysList.push({
          date: dateKey,
          status: "COMPLETED",
          workoutName: info.workoutName,
          durationMinutes: info.durationMinutes,
        });
        totalCompletedMonth++;
        tempStreak++;
        if (tempStreak > currentStreak) {
          currentStreak = tempStreak;
        }
        lastWorkoutDate = `${dateKey}T10:00:00.000Z`;
      } else {
        daysList.push({
          date: dateKey,
          status: "NO_ACTIVITY",
        });
        tempStreak = 0;
      }
    }

    return {
      studentId: clientId,
      totalCompletedMonth,
      currentStreak,
      lastWorkoutDate,
      days: daysList,
    };
  }

  async getExpiringSheets(userId: string) {
    const fiveDaysFromNow = new Date();
    fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);

    return this.prisma.client.findMany({
      where: {
        userId,
        workoutSheets: {
          some: {
            active: true,
            expiresAt: {
              lte: fiveDaysFromNow,
              gte: new Date(),
            },
          },
        },
      },
      include: {
        workoutSheets: {
          where: { active: true },
        },
      },
    });
  }

  async findLeads(userId: string) {
    return this.prisma.client.findMany({
      where: { userId, status: "Lead" },
      orderBy: { createdAt: "desc" },
    });
  }

  async convertLead(userId: string, id: string, planId?: string) {
    await this.findOne(userId, id); // Ensures existence and ownership
    return this.prisma.client.update({
      where: { id },
      data: {
        status: "Active",
        ...(planId ? { planId } : {}),
      },
    });
  }

  async generateAvatarUploadUrl(
    userId: string,
    clientId: string,
    contentType: string,
  ) {
    await this.findOne(userId, clientId); // Ensures existence and ownership

    const ext = contentType.split("/")[1];
    const objectPath = `avatars/${userId}/${clientId}.${ext}`;

    return this.gcs.generateSignedUploadUrl(objectPath, contentType);
  }
}
