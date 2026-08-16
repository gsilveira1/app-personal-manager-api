import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEvaluationDto } from './evaluations-create.dto';
import { UpdateEvaluationDto } from './evaluations-update.dto';
import { EvaluationsCalculatorService } from './evaluations-calculator.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class EvaluationsService {
  constructor(
    private prisma: PrismaService,
    private calculatorService: EvaluationsCalculatorService,
  ) {}

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
    
    // Auto-calculate body composition metrics if skinfolds & weight are available
    let bodyFatPercentage = data.bodyFatPercentage;
    let leanMass = data.leanMass;
    let fatMass = data.fatMass;
    let bodyDensity = data.bodyDensity;
    let protocol = data.protocol || 'POLLOCK_3';
    let equation = data.equation || 'SIRI';

    if (skinfolds && Object.keys(skinfolds).length > 0 && data.weight > 0) {
      // Calculate age from dateOfBirth if available
      let age = 30;
      if (client.dateOfBirth) {
        const birth = new Date(client.dateOfBirth);
        const now = new Date();
        age = now.getFullYear() - birth.getFullYear();
      }

      const calculated = this.calculatorService.calculate({
        gender: 'M', // Client model gender or default
        age,
        weight: data.weight,
        height: data.height,
        skinfolds,
        perimeters,
        protocol,
        equation,
      });

      if (!bodyFatPercentage) bodyFatPercentage = calculated.bodyFatPercentage;
      if (!leanMass) leanMass = calculated.leanMass;
      if (!fatMass) fatMass = calculated.fatMass;
      if (!bodyDensity) bodyDensity = calculated.bodyDensity;
      protocol = calculated.protocolUsed;
      equation = calculated.equationUsed;
    }

    const perimetersJson = perimeters && Object.keys(perimeters).length > 0 ? (perimeters as unknown as Prisma.InputJsonValue) : undefined;
    const skinfoldsJson = skinfolds && Object.keys(skinfolds).length > 0 ? (skinfolds as unknown as Prisma.InputJsonValue) : undefined;

    return this.prisma.evaluation.create({
      data: {
        ...rest,
        bodyFatPercentage,
        leanMass,
        fatMass,
        bodyDensity,
        protocol,
        equation,
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
    const existing = await this.findOne(userId, id);

    const { perimeters, skinfolds, ...rest } = data;
    const updateData: any = { ...rest };

    if (perimeters) {
      updateData.perimeters = perimeters as unknown as Prisma.InputJsonValue;
    }
    if (skinfolds) {
      updateData.skinfolds = skinfolds as unknown as Prisma.InputJsonValue;
    }

    const weight = data.weight ?? existing.weight;
    const skinfoldsData = (skinfolds as any) ?? existing.skinfolds;

    if (skinfoldsData && weight) {
      let age = 30;
      if (existing.client?.dateOfBirth) {
        const birth = new Date(existing.client.dateOfBirth);
        age = new Date().getFullYear() - birth.getFullYear();
      }

      const calculated = this.calculatorService.calculate({
        gender: 'M',
        age,
        weight,
        height: data.height ?? existing.height ?? undefined,
        skinfolds: skinfoldsData,
        perimeters: (perimeters as any) ?? existing.perimeters,
        protocol: data.protocol ?? existing.protocol ?? 'POLLOCK_3',
        equation: data.equation ?? existing.equation ?? 'SIRI',
      });

      if (!data.bodyFatPercentage) updateData.bodyFatPercentage = calculated.bodyFatPercentage;
      if (!data.leanMass) updateData.leanMass = calculated.leanMass;
      if (!data.fatMass) updateData.fatMass = calculated.fatMass;
      if (!data.bodyDensity) updateData.bodyDensity = calculated.bodyDensity;
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