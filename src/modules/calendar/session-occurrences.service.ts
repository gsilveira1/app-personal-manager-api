import { Injectable, Logger } from "@nestjs/common";
import { EventStatus, EventType, Prisma } from "@prisma/client";

import { WITHOUT_DELETED_CLIENT } from "../../common/prisma/soft-delete";
import { PrismaService } from "../prisma/prisma.service";
import {
  SERIES_INCLUDE,
  SESSION_INCLUDE,
  SeriesRow,
  SessionRow,
  SessionView,
} from "./calendar.types";
import {
  expandRRuleForRange,
  RRuleExpansionLimitError,
} from "./rrule-expander";
import { toStoredView, toVirtualView } from "./session-view";

/** An occurrence id may be off by less than this and still address the occurrence. */
export const OCCURRENCE_TOLERANCE_MS = 60_000;

type SeriesWithExceptions = SeriesRow & {
  exceptions: { originalStartTime: Date | null }[];
};

type ExpandableSeries = Pick<SeriesRow, "id" | "rrule" | "date" | "timezone">;

const byDate = (a: SessionView, b: SessionView) => a.date.localeCompare(b.date);

/**
 * Reads the sessions of a trainer as the calendar shows them: stored rows plus the
 * occurrences computed from each series' RRULE. The only place that expands sessions.
 */
@Injectable()
export class SessionOccurrencesService {
  private readonly logger = new Logger(SessionOccurrencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sessions inside `[start, end]`: one-off sessions, occurrences of every series that
   * have no exception, and non-cancelled exceptions whose (possibly moved) date is in
   * the range. Sessions of soft-deleted clients are left out. `workout` is not resolved.
   *
   * @example
   * const january = await occurrences.listInRange(userId, new Date("2025-01-01"), new Date("2025-01-31"));
   *
   * @param db - Client to read with; pass the transaction client to read inside a transaction
   * @throws {RRuleExpansionLimitError} When one series yields more occurrences than the cap
   */
  async listInRange(
    userId: string,
    start: Date,
    end: Date,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<SessionView[]> {
    const [stored, series] = await Promise.all([
      this.findStoredInRange(db, userId, start, end),
      this.findSeries(db, userId, start, end),
    ]);

    return [
      ...stored.map(toStoredView),
      ...series.flatMap((master) => this.expandSeries(master, start, end)),
    ].sort(byDate);
  }

  /** One-off sessions only (no series, no exceptions), oldest first. */
  async listOneOff(userId: string): Promise<SessionView[]> {
    const rows = await this.prisma.event.findMany({
      where: {
        userId,
        type: EventType.SESSION,
        rrule: null,
        parentEventId: null,
        ...WITHOUT_DELETED_CLIENT,
      },
      include: SESSION_INCLUDE,
      orderBy: { date: "asc" },
    });
    return rows.map(toStoredView);
  }

  /**
   * The start the series' rule computes within one minute of `at`.
   *
   * @returns null when the series has no occurrence there, or when its stored rule
   * cannot be expanded (logged)
   */
  findOccurrence(series: ExpandableSeries, at: Date): Date | null {
    const reach = OCCURRENCE_TOLERANCE_MS - 1;
    const [occurrence] = this.expandRule(
      series,
      new Date(at.getTime() - reach),
      new Date(at.getTime() + reach),
      [],
    );
    return occurrence ?? null;
  }

  private findStoredInRange(
    db: Prisma.TransactionClient,
    userId: string,
    start: Date,
    end: Date,
  ): Promise<SessionRow[]> {
    return db.event.findMany({
      where: {
        userId,
        type: EventType.SESSION,
        rrule: null,
        date: { gte: start, lte: end },
        NOT: { parentEventId: { not: null }, status: EventStatus.CANCELLED },
        ...WITHOUT_DELETED_CLIENT,
      },
      include: SESSION_INCLUDE,
    });
  }

  private findSeries(
    db: Prisma.TransactionClient,
    userId: string,
    start: Date,
    end: Date,
  ): Promise<SeriesWithExceptions[]> {
    return db.event.findMany({
      where: {
        userId,
        type: EventType.SESSION,
        rrule: { not: null },
        date: { lte: end },
        ...WITHOUT_DELETED_CLIENT,
      },
      include: {
        ...SERIES_INCLUDE,
        exceptions: {
          where: { originalStartTime: { gte: start, lte: end } },
          select: { originalStartTime: true },
        },
      },
    });
  }

  private expandSeries(
    series: SeriesWithExceptions,
    start: Date,
    end: Date,
  ): SessionView[] {
    const replaced = series.exceptions
      .map((exception) => exception.originalStartTime)
      .filter((date): date is Date => date !== null);

    return this.expandRule(series, start, end, replaced).map((occurrence) =>
      toVirtualView(series, occurrence),
    );
  }

  /**
   * Rules are validated on write; a stored rule that is malformed or no longer accepted
   * is logged and left out. A rule that exceeds the occurrence cap fails the request.
   */
  private expandRule(
    series: ExpandableSeries,
    start: Date,
    end: Date,
    exdates: Date[],
  ): Date[] {
    if (!series.rrule) return [];
    try {
      return expandRRuleForRange(
        series.rrule,
        series.date,
        series.timezone,
        start,
        end,
        exdates,
      );
    } catch (error) {
      if (error instanceof RRuleExpansionLimitError) {
        this.logger.error(
          `Series ${series.id} (rrule "${series.rrule}") exceeds the occurrence cap between ${start.toISOString()} and ${end.toISOString()}; the request was refused`,
        );
        throw error;
      }
      this.logger.error(
        `Series ${series.id} has a malformed rrule "${series.rrule}" and was left out: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }
}
