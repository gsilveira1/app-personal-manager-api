import { Prisma } from "@prisma/client";

import { NOT_DELETED } from "../../../common/prisma/soft-delete";
import {
  describePlanFeatures,
  isPlanFeatureKey,
  PlanFeatureKey,
} from "../../../common/types";

/** Counts live clients only (docs/api-contract-v2.md, section 7). */
export const PLAN_VIEW_INCLUDE = {
  _count: { select: { clients: { where: NOT_DELETED } } },
} satisfies Prisma.PlanInclude;

export type PlanRow = Prisma.PlanGetPayload<{
  include: typeof PLAN_VIEW_INCLUDE;
}>;

export type PlanType = "PRESENCIAL" | "CONSULTORIA";

export interface PlanView {
  id: string;
  type: PlanType;
  name: string;
  sessionsPerWeek: number;
  durationMinutes: number | null;
  price: number;
  active: boolean;
  features: PlanFeatureKey[];
  userId: string;
  createdAt: string;
  updatedAt: string;
  _count: { clients: number };
}

interface PublicFeature {
  key: string;
  name: string;
}

export interface PublicPlans {
  presencial: Array<{
    id: string;
    name: string;
    sessionsPerWeek: number;
    sessionsPerMonth: number;
    durationMinutes: number | null;
    price: number;
    features: PublicFeature[];
  }>;
  consultoria: Array<{
    id: string;
    name: string;
    sessionsPerWeek: number;
    price: number;
    features: PublicFeature[];
  }>;
}

export type PublicPlanRow = Pick<
  PlanRow,
  | "id"
  | "type"
  | "name"
  | "sessionsPerWeek"
  | "durationMinutes"
  | "price"
  | "features"
>;

/**
 * @example
 * toPlanView(row).features // ["automated_pix"]
 */
export function toPlanView(row: PlanRow): PlanView {
  return {
    id: row.id,
    type: row.type as PlanType,
    name: row.name,
    sessionsPerWeek: row.sessionsPerWeek,
    durationMinutes: row.durationMinutes,
    price: row.price,
    active: row.active,
    features: row.features.filter(isPlanFeatureKey),
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    _count: { clients: row._count.clients },
  };
}

function toPublicFeatures(keys: readonly string[]): PublicFeature[] {
  return describePlanFeatures(keys).map(({ key, name }) => ({ key, name }));
}

/** Groups a trainer's active plans the way the marketing site renders them. */
export function toPublicPlans(rows: readonly PublicPlanRow[]): PublicPlans {
  const presencial = rows
    .filter((plan) => plan.type === "PRESENCIAL")
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      sessionsPerWeek: plan.sessionsPerWeek,
      sessionsPerMonth: plan.sessionsPerWeek * 4,
      durationMinutes: plan.durationMinutes,
      price: plan.price,
      features: toPublicFeatures(plan.features),
    }));
  const consultoria = rows
    .filter((plan) => plan.type === "CONSULTORIA")
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      sessionsPerWeek: plan.sessionsPerWeek,
      price: plan.price,
      features: toPublicFeatures(plan.features),
    }));
  return { presencial, consultoria };
}
