import { Prisma } from "@prisma/client";

import { NOT_DELETED } from "../../../common/prisma/soft-delete";
import { parseClientModality, parseClientStatus } from "./client-parsing";
import { ClientQueryDto } from "./dto/client-query.dto";

type SortableField =
  | "name"
  | "email"
  | "status"
  | "modality"
  | "createdAt"
  | "updatedAt"
  | "dateOfBirth";

const SORT_FIELDS: Readonly<Record<string, SortableField>> = {
  name: "name",
  email: "email",
  status: "status",
  modality: "modality",
  createdat: "createdAt",
  created_at: "createdAt",
  updatedat: "updatedAt",
  updated_at: "updatedAt",
  dateofbirth: "dateOfBirth",
  date_of_birth: "dateOfBirth",
};

/**
 * Filter of `GET /clients`. Unknown `status` / `modality` values are ignored
 * (tolerant parsing, as before); soft-deleted clients are always excluded.
 */
export function buildClientWhere(
  userId: string,
  query: Pick<ClientQueryDto, "search" | "modality" | "status">,
): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = { userId, ...NOT_DELETED };
  if (query.search) {
    const contains = { contains: query.search, mode: "insensitive" as const };
    where.OR = [{ name: contains }, { email: contains }, { phone: contains }];
  }
  const modality = parseClientModality(query.modality);
  if (modality) where.modality = modality;
  const status = parseClientStatus(query.status);
  if (status) where.status = status;
  return where;
}

/**
 * Sort of `GET /clients`: unknown keys fall back to `name`; `id` is the tie-breaker
 * so that pages are stable when many rows share the sorted value.
 */
export function buildClientOrderBy(
  query: Pick<ClientQueryDto, "sortBy" | "sortOrder">,
): Prisma.ClientOrderByWithRelationInput[] {
  const direction: Prisma.SortOrder =
    String(query.sortOrder ?? "").toLowerCase() === "desc" ? "desc" : "asc";
  const key = (query.sortBy || "name").toLowerCase();
  const field = Object.prototype.hasOwnProperty.call(SORT_FIELDS, key)
    ? SORT_FIELDS[key]
    : "name";
  return [{ [field]: direction }, { id: "asc" }];
}
