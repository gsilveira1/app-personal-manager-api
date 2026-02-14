import { Injectable } from '@nestjs/common';
import { ClientStatus, PaymentStatus, PaymentMethod } from '@prisma/client';
import { startOfMonth } from 'date-fns';

import { CreateFinanceRecordDto } from './finances.dto';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

const WEEKS_IN_MONTH = 4.33;

@Injectable()
export class FinancesService {
  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService
  ) {}

  async createRecord(userId: string, data: CreateFinanceRecordDto) {
    // Validar se cliente pertence ao user
    const client = await this.prisma.client.findFirst({
        where: { id: data.clientId, userId }
    });
    if (!client) throw new Error("Acesso negado ou cliente não encontrado");

    return this.prisma.financeRecord.create({ data });
  }

  async markAsPaid(userId: string, id: string, method: PaymentMethod) {
    // Verificar se a fatura pertence a um cliente deste usuário
    const record = await this.prisma.financeRecord.findFirst({
        where: { id, client: { userId } }
    });
    if (!record) throw new Error("Fatura não encontrada");

    return this.prisma.financeRecord.update({
      where: { id },
      data: { status: PaymentStatus.Paid, method },
    });
  }

  // Gera faturas APENAS para os clientes deste usuário
  async generateMonthlyInvoices(userId: string) {
    const today = new Date();
    const currentMonthStart = startOfMonth(today);
    const currentMonthName = today.toLocaleString('default', { month: 'long' });

    // Buscar clientes ativos DO USUÁRIO com planos
    const activeClients = await this.prisma.client.findMany({
      where: { 
        status: ClientStatus.Active,
        planId: { not: null },
        userId: userId // Filtro Importante
      },
      include: { plan: true },
    });

    const invoicesCreated = [];

    for (const client of activeClients) {
      if (!client.plan) continue;

      const existingInvoice = await this.prisma.financeRecord.findFirst({
        where: {
          clientId: client.id,
          type: 'Subscription',
          relatedId: client.planId,
          date: {
            gte: currentMonthStart,
          },
        },
      });

      if (!existingInvoice) {
        const monthlyAmount = client.plan.pricePerSession * client.plan.sessionsPerWeek * WEEKS_IN_MONTH;
        const roundedAmount = Math.round(monthlyAmount * 100) / 100;

        const newInvoice = await this.prisma.financeRecord.create({
          data: {
            clientId: client.id,
            amount: roundedAmount,
            date: today,
            status: PaymentStatus.Pending,
            method: PaymentMethod.Pix,
            description: `Plan: ${client.plan.name} - ${currentMonthName}`,
            type: 'Subscription',
            relatedId: client.plan.id,
          },
        });
        invoicesCreated.push(newInvoice);
      }
    }

    // Se quiser integrar com Gateway de Pagamento automaticamente para gerar PIX
    if (invoicesCreated.length > 0) {
        const ids = invoicesCreated.map(i => i.id);
        // await this.paymentsService.processBatchPixGeneration(ids); 
        // Comentado para evitar chamadas reais durante o desenvolvimento
    }

    return { 
      success: true, 
      count: invoicesCreated.length, 
      generatedIds: invoicesCreated.map(i => i.id) 
    };
  }
}