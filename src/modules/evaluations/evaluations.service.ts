import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEvaluationDto } from './evaluations-create.dto';
import { UpdateEvaluationDto } from './evaluations-update.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class EvaluationsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, data: CreateEvaluationDto) {
    // 1. Verificar se o cliente pertence ao utilizador logado
    const client = await this.prisma.client.findUnique({
      where: { id: data.clientId },
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    if (client.userId !== userId) {
      throw new ForbiddenException('Não tem permissão para criar avaliações para este cliente.');
    }

    const { perimeters, skinfolds, ...rest } = data;
    
    const perimetersJson = perimeters && Object.keys(perimeters).length > 0 ? (perimeters as unknown as Prisma.InputJsonValue) : undefined;
    const skinfoldsJson = skinfolds && Object.keys(skinfolds).length > 0 ? (skinfolds as unknown as Prisma.InputJsonValue) : undefined;

    return this.prisma.evaluation.create({
      data: {
        ...rest,
        perimeters: perimetersJson,
        skinfolds: skinfoldsJson,
      },
    });
  }

  async findAll(userId: string) {
    // Filtra avaliações onde o cliente associado pertence ao userId
    return this.prisma.evaluation.findMany({
      where: {
        client: {
          userId: userId,
        },
      },
      include: {
        client: { select: { name: true, avatar: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const evaluation = await this.prisma.evaluation.findUnique({
      where: { id },
      include: { client: true },
    });

    if (!evaluation) {
      throw new NotFoundException(`Avaliação #${id} não encontrada`);
    }

    // Verifica propriedade através do cliente
    if (evaluation.client.userId !== userId) {
      throw new ForbiddenException('Acesso negado a esta avaliação.');
    }

    return evaluation;
  }

  async update(userId: string, id: string, data: UpdateEvaluationDto) {
    // Garante que a avaliação existe e pertence ao utilizador
    await this.findOne(userId, id);

    const { perimeters, skinfolds, ...rest } = data;
    const updateData: any = { ...rest };

    if (perimeters) {
      updateData.perimeters = perimeters as unknown as Prisma.InputJsonValue;
    }
    if (skinfolds) {
      updateData.skinfolds = skinfolds as unknown as Prisma.InputJsonValue;
    }

    return this.prisma.evaluation.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(userId: string, id: string) {
    // Garante que a avaliação existe e pertence ao utilizador
    await this.findOne(userId, id);
    return this.prisma.evaluation.delete({ where: { id } });
  }
}