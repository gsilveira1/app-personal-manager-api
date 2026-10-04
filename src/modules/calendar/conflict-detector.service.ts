import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AvailabilityBlocksService } from "./availability-blocks.service";
import { Interval, MS_PER_MINUTE } from "./calendar.types";
import { SessionOccurrencesService } from "./session-occurrences.service";

export interface BusyBlock extends Interval {
  title: string;
}

/** Everything that occupies a trainer's time inside a window. */
export interface BusyTime {
  sessions: Interval[];
  blocks: BusyBlock[];
}

export type SlotConflict =
  | { kind: "session" }
  | { kind: "block"; title: string };

/** Two half-open intervals overlap; touching ends do not. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start;
}

/**
 * What a slot collides with, sessions first.
 *
 * @returns null when the slot is free
 */
export function findSlotConflict(
  slot: Interval,
  busy: BusyTime,
): SlotConflict | null {
  if (busy.sessions.some((session) => overlaps(slot, session))) {
    return { kind: "session" };
  }
  const block = busy.blocks.find((candidate) => overlaps(slot, candidate));
  return block ? { kind: "block", title: block.title } : null;
}

function dayBounds(date: Date): Interval {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * The single home of the overlap rule: booking a session and the public slot search
 * both ask it what is busy.
 */
@Injectable()
export class ConflictDetectorService {
  constructor(
    private readonly occurrences: SessionOccurrencesService,
    private readonly blocks: AvailabilityBlocksService,
  ) {}

  /**
   * Non-cancelled sessions (one-off, expanded series, exceptions) of live clients and
   * availability blocks inside `[start, end]`.
   *
   * @param db - Client to read with; pass the transaction client to read inside a transaction
   */
  async loadBusy(
    userId: string,
    start: Date,
    end: Date,
    db?: Prisma.TransactionClient,
  ): Promise<BusyTime> {
    const [sessions, blocks] = await Promise.all([
      this.occurrences.listInRange(userId, start, end, db),
      this.blocks.materializeBlocksForRange(userId, start, end, db),
    ]);

    return {
      sessions: sessions
        .filter((session) => !session.cancelled)
        .map((session) => {
          const sessionStart = new Date(session.date);
          return {
            start: sessionStart,
            end: new Date(
              sessionStart.getTime() + session.durationMinutes * MS_PER_MINUTE,
            ),
          };
        }),
      blocks: blocks.map((block) => ({
        start: new Date(block.start),
        end: new Date(block.end),
        title: block.title,
      })),
    };
  }

  /**
   * Serializes bookings of one trainer on one day: takes a Postgres advisory lock that
   * is held until `tx` ends. The day is the one {@link assertSlotFree} checks, so two
   * requests that could conflict always wait for each other.
   *
   * @example
   * await prisma.$transaction(async (tx) => {
   *   await conflicts.lockDay(tx, userId, date);
   *   await conflicts.assertSlotFree(userId, date, 60, tx);
   *   return tx.event.create({ data });
   * });
   */
  async lockDay(
    tx: Prisma.TransactionClient,
    userId: string,
    date: Date,
  ): Promise<void> {
    const key = `calendar-booking:${userId}:${dayBounds(date).start.toISOString()}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
  }

  /**
   * Refuses a new session that overlaps another session of the same day or a block.
   *
   * @example
   * await conflicts.assertSlotFree(userId, new Date("2025-02-01T10:00:00Z"), 60);
   *
   * @param db - Client to read with; pass the transaction client that holds {@link lockDay}
   * @throws {ConflictException} When the slot is taken or blocked
   */
  async assertSlotFree(
    userId: string,
    date: Date,
    durationMinutes: number,
    db?: Prisma.TransactionClient,
  ): Promise<void> {
    const day = dayBounds(date);
    const busy = await this.loadBusy(userId, day.start, day.end, db);
    const slot = {
      start: date,
      end: new Date(date.getTime() + durationMinutes * MS_PER_MINUTE),
    };

    const conflict = findSlotConflict(slot, busy);
    if (!conflict) return;
    if (conflict.kind === "session") {
      throw new ConflictException(
        "Time slot is already occupied by another session",
      );
    }
    throw new ConflictException(
      `Time slot is blocked by an availability block: ${conflict.title || "Untitled"}`,
    );
  }
}
