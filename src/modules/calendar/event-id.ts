import { BadRequestException } from "@nestjs/common";
import { OccurrenceRef } from "./calendar.types";

const SEPARATOR = "_";

export type EventIdTarget =
  | { kind: "stored"; id: string }
  | ({ kind: "occurrence" } & OccurrenceRef);

/**
 * Builds the public id of one occurrence of a series.
 *
 * @example
 * formatOccurrenceId("series-uuid", new Date("2025-02-03T10:00:00Z"))
 * // "series-uuid_2025-02-03T10:00:00.000Z"
 */
export function formatOccurrenceId(
  seriesId: string,
  originalStartTime: Date,
): string {
  return `${seriesId}${SEPARATOR}${originalStartTime.toISOString()}`;
}

/**
 * Tells a stored event (UUID) from an occurrence of a series (`<seriesId>_<ISO>`).
 *
 * @throws {BadRequestException} When the occurrence part is not a valid date
 */
export function parseEventId(id: string): EventIdTarget {
  const separatorIndex = id.indexOf(SEPARATOR);
  if (separatorIndex === -1) return { kind: "stored", id };

  const seriesId = id.substring(0, separatorIndex);
  const originalStartTime = new Date(id.substring(separatorIndex + 1));
  if (!seriesId || Number.isNaN(originalStartTime.getTime())) {
    throw new BadRequestException(
      "Invalid occurrence id: expected <seriesId>_<ISO date>",
    );
  }
  return { kind: "occurrence", seriesId, originalStartTime };
}
