import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { EventStatus, EventType, Prisma } from "@prisma/client";

import { WITHOUT_DELETED_CLIENT } from "../../common/prisma/soft-delete";
import { PrismaService } from "../prisma/prisma.service";
import {
  OccurrenceRef,
  SERIES_INCLUDE,
  SESSION_INCLUDE,
  SeriesRow,
  SessionRow,
} from "./calendar.types";
import { formatOccurrenceId } from "./event-id";
import {
  OCCURRENCE_TOLERANCE_MS,
  SessionOccurrencesService,
} from "./session-occurrences.service";

/** Columns a PATCH may change on a one-off session or on an exception. */
export interface SessionChanges {
  date?: Date;
  durationMinutes?: number;
  sessionType?: string;
  category?: string;
  notes?: string | null;
  status?: EventStatus;
  workoutSheetId?: string | null;
  workoutSegmentId?: string | null;
}

/** An occurrence the caller owns, with its stored exception when there is one. */
export interface ResolvedOccurrence {
  series: SeriesRow;
  /** Canonical start computed by the rule (the exception key). */
  originalStartTime: Date;
  exception: SessionRow | null;
}

/**
 * Exceptions of a series: child events keyed by `(parentEventId, originalStartTime)`
 * that cancel, complete or move one occurrence.
 */
@Injectable()
export class SessionExceptionsService {
  private readonly logger = new Logger(SessionExceptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly occurrences: SessionOccurrencesService,
  ) {}

  /**
   * Checks that the series belongs to the caller and that the occurrence exists.
   *
   * @throws {NotFoundException} When the series does not exist (or its client is
   * soft-deleted), or the series has no occurrence at that time
   * @throws {ForbiddenException} When the series belongs to another trainer
   */
  async resolve(
    userId: string,
    ref: OccurrenceRef,
  ): Promise<ResolvedOccurrence> {
    const series = await this.requireSeries(userId, ref.seriesId);
    const exception = await this.findException(ref);
    if (exception?.originalStartTime) {
      return {
        series,
        originalStartTime: exception.originalStartTime,
        exception,
      };
    }

    const originalStartTime = this.occurrences.findOccurrence(
      series,
      ref.originalStartTime,
    );
    if (!originalStartTime) {
      throw new NotFoundException(
        `Session #${formatOccurrenceId(ref.seriesId, ref.originalStartTime)} not found`,
      );
    }
    return { series, originalStartTime, exception: null };
  }

  /**
   * Creates the exception with the master's fields copied (its date is the occurrence's
   * original start) and then applies `changes`; an existing exception only gets `changes`.
   *
   * Two first edits of one occurrence can both take the "create" branch; the unique
   * key `(parentEventId, originalStartTime)` rejects the loser, which is then retried
   * once and lands on the "update" branch, so its changes are merged instead of lost.
   *
   * @example
   * await exceptions.upsert(occurrence, { status: EventStatus.CANCELLED });
   */
  async upsert(
    occurrence: ResolvedOccurrence,
    changes: SessionChanges,
  ): Promise<SessionRow> {
    try {
      return await this.writeException(occurrence, changes);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      this.logger.warn(
        `Exception of series ${occurrence.series.id} at ${occurrence.originalStartTime.toISOString()} was created concurrently (P2002); retrying as an update`,
      );
      return this.writeException(occurrence, changes);
    }
  }

  private writeException(
    occurrence: ResolvedOccurrence,
    changes: SessionChanges,
  ): Promise<SessionRow> {
    const { series, originalStartTime } = occurrence;

    return this.prisma.event.upsert({
      where: {
        parentEventId_originalStartTime: {
          parentEventId: series.id,
          originalStartTime,
        },
      },
      create: {
        type: EventType.SESSION,
        parentEventId: series.id,
        originalStartTime,
        userId: series.userId,
        clientId: series.clientId,
        date: originalStartTime,
        durationMinutes: series.durationMinutes,
        sessionType: series.sessionType,
        category: series.category,
        timezone: series.timezone,
        workoutSheetId: series.workoutSheetId,
        workoutSegmentId: series.workoutSegmentId,
        notes: null,
        ...changes,
      },
      update: changes,
      include: SESSION_INCLUDE,
    });
  }

  private async requireSeries(
    userId: string,
    seriesId: string,
  ): Promise<SeriesRow> {
    const series = await this.prisma.event.findFirst({
      where: { id: seriesId, ...WITHOUT_DELETED_CLIENT },
      include: SERIES_INCLUDE,
    });
    const isSeries =
      series?.type === EventType.SESSION &&
      series.rrule !== null &&
      series.parentEventId === null;
    if (!series || !isSeries) {
      throw new NotFoundException(`Recurring event #${seriesId} not found`);
    }
    if (series.userId !== userId) throw new ForbiddenException();
    return series;
  }

  private findException(ref: OccurrenceRef): Promise<SessionRow | null> {
    const at = ref.originalStartTime.getTime();
    return this.prisma.event.findFirst({
      where: {
        parentEventId: ref.seriesId,
        originalStartTime: {
          gt: new Date(at - OCCURRENCE_TOLERANCE_MS),
          lt: new Date(at + OCCURRENCE_TOLERANCE_MS),
        },
      },
      include: SESSION_INCLUDE,
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
