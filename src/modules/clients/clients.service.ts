import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma, ClientStatus, ClientModality } from "@prisma/client";

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

      const dateOfBirth = data.dateOfBirth
        ? new Date(data.dateOfBirth)
        : undefined;
      const status = data.status || ClientStatus.ACTIVE;
      const modality = data.modality || ClientModality.PRESENCIAL;
      const planId = data.planId || undefined;
      const checkInFreq =
        data.checkInFrequency || data.checkInFreq || undefined;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });

      const client = await this.prisma.client.create({
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone,
          status,
          modality,
          goal: data.goal,
          avatar: data.avatar,
          notes: data.notes,
          dateOfBirth,
          checkInFreq,
          notificationEnabled:
            data.notificationEnabled !== undefined
              ? data.notificationEnabled
              : true,
          planId,
          medicalHistory: medicalHistoryInput,
          userId,
          tenantId: user?.tenantId || null,
        },
      });

      if (data.phone && client.notificationEnabled) {
        await this.prisma.notificationLog
          .create({
            data: {
              tenantId: user?.tenantId || null,
              recipientPhone: data.phone,
              templateType: "WELCOME_ANAMNESIS",
              status: "QUEUED",
              channel: "WHATSAPP",
            },
          })
          .catch(() => null);
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
      where: { userId },
      include: {
        plan: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async findStudents(
    userId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      modality?: string;
      status?: string;
      sortBy?: string;
      sortOrder?: string;
    },
  ) {
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
      const modUpper = query.modality.toUpperCase();
      if (
        modUpper === "PRESENCIAL" ||
        modUpper === "ONLINE" ||
        modUpper === "HYBRID"
      ) {
        where.modality = modUpper as ClientModality;
      }
    }

    if (query.status) {
      const statUpper = query.status.toUpperCase();
      if (statUpper === "ACTIVE" || statUpper === "ATIVO") {
        where.status = ClientStatus.ACTIVE;
      } else if (
        statUpper === "PAUSED" ||
        statUpper === "PAUSADA" ||
        statUpper === "PAUSADO"
      ) {
        where.status = ClientStatus.PAUSED;
      } else if (
        statUpper === "OVERDUE" ||
        statUpper === "EM ATRASO" ||
        statUpper === "ATRASADO" ||
        statUpper === "INACTIVE"
      ) {
        where.status = ClientStatus.OVERDUE;
      } else if (statUpper === "LEAD") {
        where.status = ClientStatus.LEAD;
      }
    }

    const sortOrderDir: Prisma.SortOrder =
      query.sortOrder && String(query.sortOrder).toLowerCase() === "desc"
        ? "desc"
        : "asc";

    const allowedSortMap: Record<
      string,
      keyof Prisma.ClientOrderByWithRelationInput
    > = {
      name: "name",
      email: "email",
      status: "status",
      modality: "modality",
      createdat: "createdAt",
      created_at: "createdAt",
      updatedat: "updatedAt",
      updated_at: "updatedAt",
      dateofbirth: "dateOfBirth",
      date_of_birth: "dateOfBirth",
    };

    const requestedKey = (query.sortBy || "name").toLowerCase();
    const resolvedField = allowedSortMap[requestedKey] || "name";

    const orderBy: Prisma.ClientOrderByWithRelationInput = {
      [resolvedField]: sortOrderDir,
    };

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
        orderBy,
      }),
    ]);

    const items = clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      modality: c.modality,
      status: c.status,
      currentPeriodEnd: c.currentPeriodEnd,
      goal: c.goal,
      notes: c.notes,
      dateOfBirth: c.dateOfBirth,
      checkInFreq: c.checkInFreq,
      checkInFrequency: c.checkInFreq,
      notificationEnabled: c.notificationEnabled,
      plan: c.plan,
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
    await this.findOne(userId, id);

    const {
      medicalHistory,
      dateOfBirth,
      planId,
      checkInFrequency,
      checkInFreq,
      type,
      subscriptionStatus,
      status,
      modality,
      ...restData
    } = data;

    const medicalHistoryInput = medicalHistory
      ? (medicalHistory as unknown as Prisma.InputJsonValue)
      : undefined;

    const parsedDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : undefined;
    const parsedPlanId = planId === "" ? null : planId;
    const effectiveCheckInFreq =
      checkInFrequency !== undefined ? checkInFrequency : checkInFreq;

    return this.prisma.client.update({
      where: { id },
      data: {
        ...restData,
        ...(status !== undefined && { status }),
        ...(modality !== undefined && { modality }),
        ...(effectiveCheckInFreq !== undefined && {
          checkInFreq: effectiveCheckInFreq,
        }),
        ...(parsedDateOfBirth !== undefined && {
          dateOfBirth: parsedDateOfBirth,
        }),
        ...(parsedPlanId !== undefined && { planId: parsedPlanId }),
        ...(medicalHistoryInput !== undefined && {
          medicalHistory: medicalHistoryInput,
        }),
      } as Prisma.ClientUpdateInput,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.client.delete({
      where: { id },
    });
  }

  async recordManualPayment(
    userId: string,
    clientId: string,
    dto: {
      paymentType: string;
      validUntil: string;
      notes?: string;
      amount?: number;
    },
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
          status: ClientStatus.ACTIVE,
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

  async updateStudentStatus(
    userId: string,
    clientId: string,
    status: string | ClientStatus,
  ) {
    await this.findOne(userId, clientId);
    let clientStatus: ClientStatus = ClientStatus.ACTIVE;
    const upper = String(status).toUpperCase();

    if (upper === "PAUSED" || upper === "PAUSADA" || upper === "PAUSADO") {
      clientStatus = ClientStatus.PAUSED;
    } else if (
      upper === "OVERDUE" ||
      upper === "EM ATRASO" ||
      upper === "ATRASADO" ||
      upper === "INACTIVE"
    ) {
      clientStatus = ClientStatus.OVERDUE;
    } else if (upper === "LEAD") {
      clientStatus = ClientStatus.LEAD;
    }

    return this.prisma.client.update({
      where: { id: clientId },
      data: {
        status: clientStatus,
      },
    });
  }

  async exportCsv(userId: string): Promise<string> {
    const clients = await this.prisma.client.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });

    const headers =
      "Nome,Telefone,Email,Modalidade,Status,VencimentoAssinatura\n";
    const rows = clients
      .map((c) => {
        const expiry = c.currentPeriodEnd
          ? c.currentPeriodEnd.toISOString().split("T")[0]
          : "N/A";
        return `"${c.name}","${c.phone}","${c.email}","${c.modality}","${c.status}","${expiry}"`;
      })
      .join("\n");

    return headers + rows;
  }

  async getActivityHeatmap(
    userId: string,
    clientId: string,
    days: number = 30,
  ) {
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

    const sessionByDateMap = new Map<
      string,
      { workoutName?: string; durationMinutes: number }
    >();
    sessions.forEach((s) => {
      const dateKey = s.completedAt.toISOString().split("T")[0];
      sessionByDateMap.set(dateKey, {
        workoutName: s.workoutName || "Treino Realizado",
        durationMinutes: Math.round(s.durationSeconds / 60),
      });
    });

    const daysList: Array<{
      date: string;
      status: "COMPLETED" | "EXPIRED" | "NO_ACTIVITY";
      workoutName?: string;
      durationMinutes?: number;
    }> = [];
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
      where: { userId, status: ClientStatus.LEAD },
      orderBy: { createdAt: "desc" },
    });
  }

  async convertLead(userId: string, id: string, planId?: string) {
    await this.findOne(userId, id);
    return this.prisma.client.update({
      where: { id },
      data: {
        status: ClientStatus.ACTIVE,
        ...(planId ? { planId } : {}),
      },
    });
  }

  async generateAvatarUploadUrl(
    userId: string,
    clientId: string,
    contentType: string,
  ) {
    await this.findOne(userId, clientId);

    const ext = contentType.split("/")[1];
    const objectPath = `avatars/${userId}/${clientId}.${ext}`;

    return this.gcs.generateSignedUploadUrl(objectPath, contentType);
  }
}
