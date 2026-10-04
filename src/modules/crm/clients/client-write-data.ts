import { ClientModality, ClientStatus, Prisma } from "@prisma/client";

import { toJsonValue } from "../../../common/types";
import { normalizeEmail } from "./client-parsing";
import { ClientWriteValues } from "./client-store.service";
import { CreateClientDto } from "./dto/create-client.dto";
import { UpdateClientDto } from "./dto/update-client.dto";

/**
 * Values of `POST /clients`. Used both for a new row and to resurrect a soft-deleted
 * one: the subscription state always restarts empty, and optional fields the body
 * omits are left alone (`undefined`), so a resurrected client keeps what it had.
 */
export function buildCreateValues(dto: CreateClientDto): ClientWriteValues {
  return {
    name: dto.name,
    phone: dto.phone,
    status: dto.status ?? ClientStatus.ACTIVE,
    modality: dto.modality ?? ClientModality.PRESENCIAL,
    goal: dto.goal,
    avatar: dto.avatar,
    notes: dto.notes,
    dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
    checkInFreq: dto.checkInFrequency ?? dto.checkInFreq,
    medicalHistory: dto.medicalHistory
      ? toJsonValue(dto.medicalHistory)
      : undefined,
    notificationEnabled: dto.notificationEnabled ?? true,
    planId: dto.planId ?? null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
  };
}

/**
 * Data of `PATCH /clients/:id`: only what the body carries. `null` is ignored for
 * columns that cannot be null (`@IsOptional()` lets it through validation);
 * `planId: null` unlinks the plan.
 */
export function buildUpdateData(
  dto: UpdateClientDto,
): Prisma.ClientUncheckedUpdateInput {
  return {
    name: dto.name ?? undefined,
    email: dto.email ? normalizeEmail(dto.email) : undefined,
    phone: dto.phone ?? undefined,
    status: dto.status ?? undefined,
    modality: dto.modality ?? undefined,
    goal: dto.goal,
    avatar: dto.avatar,
    notes: dto.notes,
    dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
    checkInFreq: dto.checkInFrequency ?? dto.checkInFreq,
    medicalHistory: dto.medicalHistory
      ? toJsonValue(dto.medicalHistory)
      : undefined,
    notificationEnabled: dto.notificationEnabled ?? undefined,
    planId: dto.planId,
  };
}
