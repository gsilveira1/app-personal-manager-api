import { ClientModality, ClientStatus } from "@prisma/client";

const STATUS_SYNONYMS: Readonly<Record<string, ClientStatus>> = {
  ACTIVE: ClientStatus.ACTIVE,
  ATIVO: ClientStatus.ACTIVE,
  PAUSED: ClientStatus.PAUSED,
  PAUSADA: ClientStatus.PAUSED,
  PAUSADO: ClientStatus.PAUSED,
  OVERDUE: ClientStatus.OVERDUE,
  "EM ATRASO": ClientStatus.OVERDUE,
  EM_ATRASO: ClientStatus.OVERDUE,
  ATRASADO: ClientStatus.OVERDUE,
  INACTIVE: ClientStatus.OVERDUE,
  LEAD: ClientStatus.LEAD,
};

const MODALITY_SYNONYMS: Readonly<Record<string, ClientModality>> = {
  PRESENCIAL: ClientModality.PRESENCIAL,
  "IN-PERSON": ClientModality.PRESENCIAL,
  IN_PERSON: ClientModality.PRESENCIAL,
  ONLINE: ClientModality.ONLINE,
  HYBRID: ClientModality.HYBRID,
  HÍBRIDO: ClientModality.HYBRID,
  HIBRIDO: ClientModality.HYBRID,
};

function lookup<T>(table: Readonly<Record<string, T>>, raw: unknown) {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;
}

/**
 * Case-insensitive status parser shared by the body DTOs and the list filter.
 *
 * @returns undefined when the value is not a status or one of its synonyms
 * @example
 * parseClientStatus("em atraso") // ClientStatus.OVERDUE
 */
export function parseClientStatus(raw: unknown): ClientStatus | undefined {
  return lookup(STATUS_SYNONYMS, raw);
}

/**
 * @returns undefined when the value is not a modality or one of its synonyms
 * @example
 * parseClientModality("in-person") // ClientModality.PRESENCIAL
 */
export function parseClientModality(raw: unknown): ClientModality | undefined {
  return lookup(MODALITY_SYNONYMS, raw);
}

/**
 * Client e-mails are stored lower-cased and trimmed, which makes the
 * `(email, userId)` unique key case-insensitive in practice.
 *
 * @example
 * normalizeEmail("  Maria@Example.COM ") // "maria@example.com"
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
