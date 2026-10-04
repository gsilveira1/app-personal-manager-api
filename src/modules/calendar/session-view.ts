import { InternalServerErrorException } from "@nestjs/common";
import { EventStatus } from "@prisma/client";
import { SeriesRow, SessionRow, SessionView } from "./calendar.types";
import { formatOccurrenceId } from "./event-id";

type SessionSource = SeriesRow | SessionRow;

/** Everything a view shares regardless of how the session is stored. */
type SessionCore = Omit<
  SessionView,
  | "id"
  | "notes"
  | "isVirtual"
  | "recurringEventId"
  | "recurrenceId"
  | "originalStartTime"
  | "exceptionId"
  | "rrule"
>;

function malformed(row: SessionSource, reason: string): never {
  throw new InternalServerErrorException(
    `Event ${row.id} is not a well-formed session: ${reason}`,
  );
}

function sessionCore(
  row: SessionSource,
  date: Date,
  status: EventStatus,
): SessionCore {
  if (!row.clientId || !row.client) malformed(row, "it has no client");
  if (!row.sessionType || !row.category) {
    malformed(row, "sessionType or category is missing");
  }
  return {
    date: date.toISOString(),
    durationMinutes: row.durationMinutes,
    type: row.sessionType,
    category: row.category,
    status,
    completed: status === EventStatus.COMPLETED,
    cancelled: status === EventStatus.CANCELLED,
    clientId: row.clientId,
    userId: row.userId,
    client: row.client,
    workoutSheetId: row.workoutSheetId,
    workoutSegmentId: row.workoutSegmentId,
    workout: null,
    timezone: row.timezone,
  };
}

function seriesPointers(seriesId: string, originalStartTime: Date) {
  return {
    id: formatOccurrenceId(seriesId, originalStartTime),
    isVirtual: true,
    recurringEventId: seriesId,
    recurrenceId: seriesId,
    originalStartTime: originalStartTime.toISOString(),
  };
}

function exceptionView(row: SessionRow): SessionView {
  if (!row.parentEventId || !row.originalStartTime || !row.parent) {
    malformed(row, "the exception lost its series");
  }
  return {
    ...sessionCore(row, row.date, row.status),
    ...seriesPointers(row.parentEventId, row.originalStartTime),
    notes: row.notes ?? row.parent.notes,
    exceptionId: row.id,
    rrule: row.parent.rrule,
  };
}

/**
 * View of a stored row: a one-off session, a series master, or an exception
 * (which is presented as the occurrence it replaces). `workout` is left null;
 * SessionWorkoutsService fills it.
 *
 * @throws {InternalServerErrorException} When the row is not a well-formed session
 */
export function toStoredView(row: SessionRow): SessionView {
  if (row.parentEventId) return exceptionView(row);
  return {
    ...sessionCore(row, row.date, row.status),
    id: row.id,
    notes: row.notes,
    isVirtual: false,
    recurringEventId: null,
    recurrenceId: null,
    originalStartTime: null,
    exceptionId: null,
    rrule: row.rrule,
  };
}

/**
 * View of an occurrence of a series that has no stored exception.
 *
 * @throws {InternalServerErrorException} When the master is not a well-formed session
 */
export function toVirtualView(
  series: SeriesRow,
  occurrence: Date,
): SessionView {
  return {
    ...sessionCore(series, occurrence, EventStatus.SCHEDULED),
    ...seriesPointers(series.id, occurrence),
    notes: series.notes,
    exceptionId: null,
    rrule: series.rrule,
  };
}

/**
 * Status after a PATCH: `cancelled: true` wins, then `completed: true`; sending
 * `false` only undoes the matching state.
 *
 * @example
 * nextStatus("SCHEDULED", { completed: true }) // "COMPLETED"
 * nextStatus("CANCELLED", { cancelled: false }) // "SCHEDULED"
 */
export function nextStatus(
  current: EventStatus,
  flags: { completed?: boolean; cancelled?: boolean },
): EventStatus {
  if (flags.cancelled === true) return EventStatus.CANCELLED;
  if (flags.completed === true) return EventStatus.COMPLETED;
  const undone =
    (flags.completed === false && current === EventStatus.COMPLETED) ||
    (flags.cancelled === false && current === EventStatus.CANCELLED);
  return undone ? EventStatus.SCHEDULED : current;
}

/** SCHEDULED ↔ COMPLETED, as `POST /sessions/:id/toggle-complete` does. */
export function toggledStatus(current: EventStatus): EventStatus {
  return current === EventStatus.COMPLETED
    ? EventStatus.SCHEDULED
    : EventStatus.COMPLETED;
}
