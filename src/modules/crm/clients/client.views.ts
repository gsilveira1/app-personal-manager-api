import {
  Client,
  ClientModality,
  ClientStatus,
  Payment,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
} from "@prisma/client";

import { ActiveSheetSummary } from "../../../common/ports";
import {
  PLAN_VIEW_INCLUDE,
  PlanRow,
  PlanView,
  toPlanView,
} from "../plans/plan.views";

export const CLIENT_VIEW_INCLUDE = {
  plan: { select: { id: true, name: true } },
} satisfies Prisma.ClientInclude;

export const CLIENT_DETAIL_INCLUDE = {
  plan: { include: PLAN_VIEW_INCLUDE },
  payments: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
} satisfies Prisma.ClientInclude;

export type ClientRow = Client & { plan: { id: string; name: string } | null };
export type ClientDetailRow = Client & {
  plan: PlanRow | null;
  payments: Payment[];
};

export interface ClientView {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: ClientStatus;
  modality: ClientModality;
  goal: string | null;
  avatar: string | null;
  notes: string | null;
  dateOfBirth: string | null;
  checkInFreq: string | null;
  /** Same value as `checkInFreq`, kept for the client app. */
  checkInFrequency: string | null;
  medicalHistory: Prisma.JsonValue | null;
  notificationEnabled: boolean;
  planId: string | null;
  plan: { id: string; name: string } | null;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  gatewayCustomerId: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export type ClientListItem = ClientView & {
  activeWorkoutSheet: {
    id: string;
    name: string;
    expiresAt: string | null;
  } | null;
};

export interface PaymentView {
  id: string;
  clientId: string;
  userId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amount: number;
  method: string | null;
  externalId: string | null;
  date: string;
  periodEnd: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ClientDetail = Omit<ClientView, "plan"> & {
  plan: PlanView | null;
  payments: PaymentView[];
};

export type WelcomeMessageOutcome = "QUEUED" | "SKIPPED" | "FAILED";

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** Every Client column except `plan`; `deletedAt` is never exposed. */
function toClientFields(row: Client): Omit<ClientView, "plan"> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    modality: row.modality,
    goal: row.goal,
    avatar: row.avatar,
    notes: row.notes,
    dateOfBirth: iso(row.dateOfBirth),
    checkInFreq: row.checkInFreq,
    checkInFrequency: row.checkInFreq,
    medicalHistory: row.medicalHistory,
    notificationEnabled: row.notificationEnabled,
    planId: row.planId,
    subscriptionStatus: row.subscriptionStatus,
    currentPeriodEnd: iso(row.currentPeriodEnd),
    gatewayCustomerId: row.gatewayCustomerId,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * @example
 * toClientView(row).checkInFrequency === row.checkInFreq
 */
export function toClientView(row: ClientRow): ClientView {
  return {
    ...toClientFields(row),
    plan: row.plan ? { id: row.plan.id, name: row.plan.name } : null,
  };
}

export function toClientListItem(
  row: ClientRow,
  sheet: ActiveSheetSummary | undefined,
): ClientListItem {
  return {
    ...toClientView(row),
    activeWorkoutSheet: sheet
      ? { id: sheet.id, name: sheet.name, expiresAt: iso(sheet.expiresAt) }
      : null,
  };
}

export function toPaymentView(row: Payment): PaymentView {
  return {
    id: row.id,
    clientId: row.clientId,
    userId: row.userId,
    provider: row.provider,
    status: row.status,
    amount: row.amount,
    method: row.method,
    externalId: row.externalId,
    date: row.date.toISOString(),
    periodEnd: iso(row.periodEnd),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toClientDetail(row: ClientDetailRow): ClientDetail {
  return {
    ...toClientFields(row),
    plan: row.plan ? toPlanView(row.plan) : null,
    payments: row.payments.map(toPaymentView),
  };
}
