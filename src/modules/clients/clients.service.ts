import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { GcsService } from '../gcs/gcs.service';
import { CreateClientDto } from './clients-create.dto';
import { UpdateClientDto } from './clients-update.dto';

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private gcs: GcsService,
  ) { }

  async create(userId: string, data: CreateClientDto) {
    try {
      const medicalHistoryInput = data.medicalHistory
        ? (data.medicalHistory as unknown as Prisma.InputJsonValue)
        : undefined;

      return await this.prisma.client.create({
        data: {
          ...data,
          medicalHistory: medicalHistoryInput,
          userId, // Associa ao utilizador logado
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }
  }

  async findAll(userId: string) {
    return this.prisma.client.findMany({
      where: { userId }, // Filtra apenas clientes deste utilizador
      include: {
        plan: { select: { name: true } }
      },
      orderBy: { name: 'asc' }
    });
  }

  async findOne(userId: string, id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        plan: true,
        workouts: true,
      },
    });

    if (!client) {
      throw new NotFoundException(`Client #${id} not found`);
    }

    // Verificação de Segurança
    if (client.userId !== userId) {
      throw new ForbiddenException('Acesso negado a este cliente');
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

  async findLeads(userId: string) {
    return this.prisma.client.findMany({
      where: { userId, status: 'Lead' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async convertLead(userId: string, id: string, planId?: string) {
    await this.findOne(userId, id); // Ensures existence and ownership
    return this.prisma.client.update({
      where: { id },
      data: {
        status: 'Active',
        ...(planId ? { planId } : {}),
      },
    });
  }

  async generateAvatarUploadUrl(userId: string, clientId: string, contentType: string) {
    await this.findOne(userId, clientId); // Ensures existence and ownership

    const ext = contentType.split('/')[1];
    const objectPath = `avatars/${userId}/${clientId}.${ext}`;

    return this.gcs.generateSignedUploadUrl(objectPath, contentType);
  }
}