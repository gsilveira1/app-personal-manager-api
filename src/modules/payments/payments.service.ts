import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // Gera uma cobrança PIX para um registro financeiro específico via Mercado Pago
  async generatePixCharge(financeRecordId: string) {
    const record = await this.prisma.financeRecord.findUnique({
      where: { id: financeRecordId },
      include: { client: true },
    });

    if (!record) throw new Error('Registro financeiro não encontrado');

    const accessToken = this.configService.get<string>('MERCADO_PAGO_ACCESS_TOKEN');
    if (!accessToken) {
      this.logger.error('MERCADO_PAGO_ACCESS_TOKEN não configurado.');
      throw new InternalServerErrorException('Configuração de pagamento inválida.');
    }

    // Payload específico para o Mercado Pago
    // Nota: O CPF é obrigatório para PIX. Como o model Client atual não tem CPF,
    // estou usando um valor genérico de teste. Em produção, adicione o campo 'cpf' ao Client.
    const payload = {
      transaction_amount: record.amount,
      description: record.description?.substring(0, 200) || 'Serviços Fitness',
      payment_method_id: 'pix',
      payer: {
        email: record.client.email,
        first_name: record.client.name.split(' ')[0],
        last_name: record.client.name.split(' ').slice(1).join(' ') || 'Cliente',
        identification: {
          type: 'CPF',
          number: '19119119100', // TODO: Substituir pelo CPF real do cliente armazenado no banco
        },
      },
      external_reference: record.id,
      notification_url: this.configService.get<string>('WEBHOOK_URL'), // Opcional: para receber confirmação automática
    };

    try {
      this.logger.log(`Iniciando transação PIX Mercado Pago para Fatura #${financeRecordId} - Valor: ${record.amount}`);

      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://api.mercadopago.com/v1/payments',
          payload,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'X-Idempotency-Key': record.id, // Garante que não haja cobrança duplicada na mesma requisição
            },
          },
        ),
      );

      const transactionData = data.point_of_interaction?.transaction_data;

      this.logger.log(`PIX gerado com sucesso via Mercado Pago. ID: ${data.id}`);

      return {
        success: true,
        pixCopiaECola: transactionData?.qr_code,
        qrCodeBase64: transactionData?.qr_code_base64, // Use isso para exibir a imagem (data:image/png;base64,...)
        externalId: data.id.toString(),
        status: data.status, // 'pending', 'approved', etc.
        ticketUrl: transactionData?.ticket_url,
      };
    } catch (error: unknown) {
      this.logger.error(
        'Erro ao gerar PIX no Mercado Pago',
        error instanceof Error ? error.message : 'Erro desconhecido',
      );
      throw new InternalServerErrorException('Falha ao processar pagamento no gateway.');
    }
  }

  // Método para processar cobranças em lote
  async processBatchPixGeneration(financeRecordIds: string[]) {
    const results = [];
    for (const id of financeRecordIds) {
      try {
        const pixData = await this.generatePixCharge(id);
        results.push({ id, ...pixData });
      } catch (error: unknown) {
        results.push({ id, status: 'error', message: error instanceof Error ? error.message : 'Erro desconhecido' });
      }
    }
    return results;
  }
}