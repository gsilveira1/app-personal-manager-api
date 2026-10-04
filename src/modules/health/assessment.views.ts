import { InternalServerErrorException, Logger } from "@nestjs/common";
import { Assessment, Prisma } from "@prisma/client";
import {
  AnamnesisData,
  ASSESSMENT_DATA_VERSION,
  isPlainObject,
  PhysicalEvaluationData,
} from "../../common/types";

const logger = new Logger("AssessmentViews");

export type AnamnesisStatus = "PENDING" | "EXPIRED" | "SUBMITTED";

/** Display projection of the client allowed by ownership rule R2. */
export const CLIENT_DISPLAY = { select: { name: true, avatar: true } } as const;

export type EvaluationRow = Assessment & {
  client?: { name: string; avatar: string | null };
};

export interface EvaluationView extends Omit<
  PhysicalEvaluationData,
  "version"
> {
  id: string;
  clientId: string;
  date: Date;
  client?: { name: string; avatar: string | null };
  createdAt: Date;
  updatedAt: Date;
}

export interface AnamnesisView extends Omit<AnamnesisData, "version"> {
  id: string;
  clientId: string;
  status: AnamnesisStatus;
  isCurrent: boolean;
  tokenUsed: boolean;
  date: Date;
  createdAt: Date;
}

function readEnvelope(
  stored: Prisma.JsonValue,
  assessmentId: string,
): Record<string, unknown> {
  if (!isPlainObject(stored) || stored.version !== ASSESSMENT_DATA_VERSION) {
    logger.error(
      `Malformed Assessment.data (assessmentId=${assessmentId}): expected an object with version ${ASSESSMENT_DATA_VERSION}`,
    );
    throw new InternalServerErrorException(
      `Assessment ${assessmentId} has a malformed data document`,
    );
  }
  return stored;
}

/**
 * Reads `Assessment.data` of a PHYSICAL_EVALUATION row.
 *
 * @throws {InternalServerErrorException} When the stored document is malformed
 */
export function readPhysicalEvaluationData(
  stored: Prisma.JsonValue,
  assessmentId: string,
): PhysicalEvaluationData {
  const document = readEnvelope(stored, assessmentId);
  if (typeof document.weight !== "number") {
    logger.error(
      `Malformed Assessment.data (assessmentId=${assessmentId}): weight is not a number`,
    );
    throw new InternalServerErrorException(
      `Assessment ${assessmentId} has a malformed data document`,
    );
  }
  return document as unknown as PhysicalEvaluationData;
}

/**
 * Reads `Assessment.data` of an ANAMNESIS row.
 *
 * @throws {InternalServerErrorException} When the stored document is malformed
 */
export function readAnamnesisData(
  stored: Prisma.JsonValue,
  assessmentId: string,
): AnamnesisData {
  return readEnvelope(stored, assessmentId) as unknown as AnamnesisData;
}

/** Flattens a PHYSICAL_EVALUATION row into the wire shape. */
export function toEvaluationView(row: EvaluationRow): EvaluationView {
  const { version: _version, ...metrics } = readPhysicalEvaluationData(
    row.data,
    row.id,
  );
  return {
    id: row.id,
    clientId: row.clientId,
    date: row.date,
    ...metrics,
    ...(row.client ? { client: row.client } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** magicToken null -> SUBMITTED; else tokenExpiresAt in the past -> EXPIRED; else PENDING. */
export function anamnesisStatus(
  row: Pick<Assessment, "magicToken" | "tokenExpiresAt">,
  now: Date,
): AnamnesisStatus {
  if (row.magicToken === null) return "SUBMITTED";
  if (row.tokenExpiresAt !== null && row.tokenExpiresAt <= now)
    return "EXPIRED";
  return "PENDING";
}

function findCurrentId(rows: readonly Assessment[]): string | null {
  let current: Assessment | null = null;
  for (const row of rows) {
    if (row.magicToken !== null) continue;
    if (current === null || row.date > current.date) current = row;
  }
  return current?.id ?? null;
}

/**
 * Flattens ANAMNESIS rows. `isCurrent` is derived: the submitted row with the latest
 * `date`. The magic token is never part of the view.
 */
export function toAnamnesisViews(
  rows: readonly Assessment[],
  now: Date,
): AnamnesisView[] {
  const currentId = findCurrentId(rows);
  return rows.map((row) => {
    const { version: _version, ...answers } = readAnamnesisData(
      row.data,
      row.id,
    );
    const status = anamnesisStatus(row, now);
    return {
      id: row.id,
      clientId: row.clientId,
      status,
      isCurrent: row.id === currentId,
      tokenUsed: status === "SUBMITTED",
      date: row.date,
      createdAt: row.createdAt,
      ...answers,
    };
  });
}
