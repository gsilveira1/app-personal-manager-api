import { EventStatus, Prisma } from "@prisma/client";

/** Default TZID of an event when the request does not send one. */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export const MS_PER_MINUTE = 60_000;

/** Display projection of the client allowed by ownership rule R2. */
const CLIENT_DISPLAY = { select: { name: true, avatar: true } } as const;

/** Relations loaded with every stored session row (one-off, master or exception). */
export const SESSION_INCLUDE = {
  client: CLIENT_DISPLAY,
  parent: { select: { notes: true, rrule: true } },
} satisfies Prisma.EventInclude;

/** Relations loaded with a series master before it is expanded. */
export const SERIES_INCLUDE = {
  client: CLIENT_DISPLAY,
} satisfies Prisma.EventInclude;

export type SessionRow = Prisma.EventGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

export type SeriesRow = Prisma.EventGetPayload<{
  include: typeof SERIES_INCLUDE;
}>;

/** What `GET /sessions` and the other session endpoints return (contract 6.4). */
export interface SessionView {
  /** UUID, or `<seriesId>_<ISO originalStartTime>` for an occurrence of a series. */
  id: string;
  date: string;
  durationMinutes: number;
  type: string;
  category: string;
  notes: string | null;
  status: EventStatus;
  completed: boolean;
  cancelled: boolean;
  clientId: string;
  userId: string;
  client: { name: string; avatar: string | null };
  workoutSheetId: string | null;
  workoutSegmentId: string | null;
  workout: { id: string; name: string; letter: string } | null;
  timezone: string;
  isVirtual: boolean;
  recurringEventId: string | null;
  recurrenceId: string | null;
  originalStartTime: string | null;
  exceptionId: string | null;
  rrule: string | null;
}

export interface BlockView {
  id: string;
  title: string;
  rrule: string | null;
  timezone: string;
  dtstart: string;
  dtend: string;
  notes: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterializedBlock {
  id: string;
  blockId: string;
  title: string;
  start: string;
  end: string;
  isRecurring: boolean;
  notes: string | null;
}

export interface AvailableSlot {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:mm" */
  time: string;
  type: "In-Person";
  available: true;
}

/** Half-open time interval `[start, end)`. */
export interface Interval {
  start: Date;
  end: Date;
}

/** One occurrence of a series, addressed by the start the RRULE computed for it. */
export interface OccurrenceRef {
  seriesId: string;
  originalStartTime: Date;
}
