import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ClientStatus,
  PaymentProvider,
  PaymentStatus,
  SubscriptionStatus,
} from "@prisma/client";

import { CLIENT_DIRECTORY, ClientDirectory } from "../../../common/ports";
import { NOT_DELETED } from "../../../common/prisma/soft-delete";
import { PrismaService } from "../../prisma/prisma.service";
import { isRecordNotFound } from "../prisma-errors";
import {
  CLIENT_VIEW_INCLUDE,
  ClientView,
  PaymentView,
  toClientView,
  toPaymentView,
} from "./client.views";
import { RecordPaymentDto } from "./dto/record-payment.dto";

export interface RecordedPayment {
  message: string;
  payment: PaymentView;
  client: ClientView;
}

@Injectable()
export class ClientPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLIENT_DIRECTORY) private readonly directory: ClientDirectory,
  ) {}

  /**
   * Records a manual payment and reactivates the client, in one transaction:
   * either both rows are written or neither.
   *
   * @throws {NotFoundException} When the client does not exist or is soft-deleted
   * @throws {ForbiddenException} When it belongs to another trainer
   */
  async record(
    userId: string,
    clientId: string,
    dto: RecordPaymentDto,
  ): Promise<RecordedPayment> {
    await this.directory.requireOwned(userId, clientId);
    const [payment, client] = await this.write(userId, clientId, dto);
    return {
      message: "Pagamento manual registrado com sucesso",
      payment: toPaymentView(payment),
      client: toClientView(client),
    };
  }

  /**
   * The soft-delete filter is part of the client update, so a client deleted between
   * the ownership check and here aborts the transaction (no orphan payment).
   */
  private async write(userId: string, clientId: string, dto: RecordPaymentDto) {
    const periodEnd = new Date(dto.periodEnd);
    try {
      return await this.prisma.$transaction([
        this.prisma.payment.create({
          data: {
            clientId,
            userId,
            provider: PaymentProvider.MANUAL,
            status: PaymentStatus.PAID,
            amount: dto.amount,
            method: dto.method,
            date: new Date(),
            periodEnd,
            notes: dto.notes,
          },
        }),
        this.prisma.client.update({
          where: { id: clientId, userId, ...NOT_DELETED },
          data: {
            status: ClientStatus.ACTIVE,
            currentPeriodEnd: periodEnd,
            subscriptionStatus: SubscriptionStatus.ACTIVE,
          },
          include: CLIENT_VIEW_INCLUDE,
        }),
      ]);
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw new NotFoundException(`Client #${clientId} not found`);
      }
      throw error;
    }
  }
}
