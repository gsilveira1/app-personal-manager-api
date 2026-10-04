import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { NOT_DELETED } from "../../../common/prisma/soft-delete";
import { PrismaService } from "../../prisma/prisma.service";
import { isRecordNotFound, isUniqueViolation } from "../prisma-errors";
import { CLIENT_VIEW_INCLUDE, ClientRow } from "./client.views";

/** Columns a create (or a resurrection) may set; e-mail and owner are the key. */
export type ClientWriteValues = Pick<
  Prisma.ClientUncheckedCreateInput,
  | "name"
  | "phone"
  | "status"
  | "modality"
  | "goal"
  | "avatar"
  | "notes"
  | "dateOfBirth"
  | "checkInFreq"
  | "medicalHistory"
  | "notificationEnabled"
  | "planId"
  | "subscriptionStatus"
  | "currentPeriodEnd"
>;

/** What a soft-deleted client holds that a resurrection may want to keep. */
export type StoredClientIdentity = Pick<ClientRow, "name" | "phone" | "notes">;

/** Decides the columns a resurrection writes, given the stored row. */
export type ResurrectionPolicy = (
  stored: StoredClientIdentity,
) => Partial<ClientWriteValues>;

/**
 * The writes on Client that need care around soft delete and the `(email, userId)`
 * unique key. Rules: docs/api-contract-v2.md, section 7.
 */
@Injectable()
export class ClientStoreService {
  private readonly logger = new Logger(ClientStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Brings back the trainer's soft-deleted client with that e-mail (keeping its
   * history) or, when there is none, creates a new one. A live client is never changed.
   *
   * @param email - Already normalised (lower-cased, trimmed)
   * @param onResurrect - When given, decides what a resurrection writes from the
   *   stored row, instead of `values`. The public lead form uses it so an
   *   unauthenticated caller cannot replace the stored name or phone.
   * @throws {ConflictException} When the e-mail belongs to a live client of the trainer
   */
  async resurrectOrCreate(
    userId: string,
    email: string,
    values: ClientWriteValues,
    conflictMessage: string,
    onResurrect?: ResurrectionPolicy,
  ): Promise<ClientRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const count = onResurrect
          ? await this.resurrectWithPolicy(tx, userId, email, onResurrect)
          : await this.resurrectWith(tx, { userId, email }, values);
        if (count === 0) {
          return tx.client.create({
            data: { ...values, email, userId },
            include: CLIENT_VIEW_INCLUDE,
          });
        }
        this.logger.log(`Resurrected soft-deleted client of trainer ${userId}`);
        return tx.client.findUniqueOrThrow({
          where: { email_userId: { email, userId } },
          include: CLIENT_VIEW_INCLUDE,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(conflictMessage);
      }
      throw error;
    }
  }

  /** @returns how many rows came back (0 or 1) */
  private async resurrectWith(
    tx: Prisma.TransactionClient,
    key: { id?: string; userId: string; email: string },
    data: Prisma.ClientUncheckedUpdateManyInput,
  ): Promise<number> {
    const { count } = await tx.client.updateMany({
      where: { ...key, deletedAt: { not: null } },
      data: { ...data, deletedAt: null },
    });
    return count;
  }

  /**
   * Reads the deleted row first so the policy can keep what is stored. The write
   * repeats the soft-delete filter: if the row came back in the meantime, nothing
   * is written and the following create answers 409 through the unique key.
   */
  private async resurrectWithPolicy(
    tx: Prisma.TransactionClient,
    userId: string,
    email: string,
    onResurrect: ResurrectionPolicy,
  ): Promise<number> {
    const stored = await tx.client.findFirst({
      where: { userId, email, deletedAt: { not: null } },
      select: { id: true, name: true, phone: true, notes: true },
    });
    if (!stored) return 0;
    const { id, ...identity } = stored;
    return this.resurrectWith(tx, { id, userId, email }, onResurrect(identity));
  }

  /**
   * Updates a live client of the trainer. The soft-delete filter is part of the
   * write, so a client deleted between the ownership check and here is not touched.
   *
   * @throws {NotFoundException} When the client was deleted in the meantime
   * @throws {ConflictException} When the new e-mail is held by another row of the trainer
   */
  async updateLive(
    userId: string,
    id: string,
    data: Prisma.ClientUncheckedUpdateInput,
  ): Promise<ClientRow> {
    try {
      return await this.prisma.client.update({
        where: { id, userId, ...NOT_DELETED },
        data,
        include: CLIENT_VIEW_INCLUDE,
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw new NotFoundException(`Client #${id} not found`);
      }
      if (isUniqueViolation(error)) {
        throw new ConflictException("Email already exists");
      }
      throw error;
    }
  }
}
