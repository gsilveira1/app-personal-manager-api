import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { addDays, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, type WorkHoursConfig } from '../settings/settings.service';
import { AvailabilityBlocksService } from '../availability-blocks/availability-blocks.service';
import { expandRRuleForRange } from '../../utils/rrule-expander';
import { CreateSessionDto, UpdateSessionDto } from './sessions.dto';
import { CreateRecurringEventDto, UpsertSessionExceptionDto } from './sessions-rrule.dto';
import { Session } from '@prisma/client';

// ─── Shape returned when materializing recurring events ─────────────────────
export interface MaterializedSession {
  id: string;               // "<recurringEventId>_<ISO>" — virtual id
  recurringEventId: string;
  originalStartTime: string; // ISO — the "canonical" date per the RRULE
  date: string;             // ISO — actual start (may be overridden by exception)
  durationMinutes: number;
  type: string;
  category: string;
  notes: string | null;
  completed: boolean;
  cancelled: boolean;
  clientId: string;
  userId: string;
  linkedWorkoutId: string | null;
  recurrenceId: string;     // same as recurringEventId (for UI compat)
  isVirtual: true;
  exceptionId: string | null;
}

// ─── Union type for the calendar ─────────────────────────────────────────────
export type CalendarSession = (Session & { isVirtual?: false }) | MaterializedSession;

// Map JS getDay() (0=Sun) → config key
const DAY_MAP: Record<number, keyof Omit<WorkHoursConfig, 'slotDurationMinutes'>> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

@Injectable()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private availabilityBlocksService: AvailabilityBlocksService,
  ) { }

  // ═══════════════════════════════════════════════════════════
  //  LEGACY: single-instance + eager-create recurrence
  //  (kept for backward compatibility with old sessions)
  // ═══════════════════════════════════════════════════════════

  async create(userId: string, data: CreateSessionDto) {
    const client = await this.prisma.client.findUnique({ where: { id: data.clientId } });
    if (client && client.userId !== userId) throw new ForbiddenException('Cliente inválido');

    return this.prisma.session.create({
      data: { ...data, userId },
    });
  }

  /** @deprecated Use createRecurringEvent instead */
  async createRecurring(
    userId: string,
    baseSessionData: Omit<CreateSessionDto, 'date' | 'startDateStr' | 'frequency' | 'untilDateStr'>,
    startDateStr: string,
    frequency: 'weekly' | 'bi-weekly',
    untilDateStr: string,
  ) {
    const sessionsToCreate = [];
    const recurrenceId = `rec-${uuidv4()}`;

    let currentDate = parseISO(startDateStr);
    const untilDate = parseISO(untilDateStr);
    const increment = frequency === 'weekly' ? 7 : 14;

    while (currentDate <= untilDate) {
      sessionsToCreate.push({
        ...baseSessionData,
        date: currentDate,
        recurrenceId,
        completed: false,
        userId,
      });
      currentDate = addDays(currentDate, increment);
    }

    return this.prisma.$transaction(
      sessionsToCreate.map((session) =>
        this.prisma.session.create({ data: session }),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  RRULE-BASED RECURRENCE (Google Calendar model)
  // ═══════════════════════════════════════════════════════════

  /**
   * Store a recurring event master. No instances are written to the DB.
   * The RRULE string controls all future expansions.
   */
  async createRecurringEvent(userId: string, dto: CreateRecurringEventDto) {
    const { rrule, timezone, dtstart, durationMinutes, type, category, clientId, linkedWorkoutId, notes } = dto;

    // Verify ownership
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.userId !== userId) throw new ForbiddenException('Cliente inválido');

    return this.prisma.recurringEvent.create({
      data: {
        rrule,
        timezone,
        dtstart: new Date(dtstart),
        durationMinutes,
        type,
        category,
        notes,
        linkedWorkoutId,
        clientId,
        userId,
      },
    });
  }

  /**
   * Expand all RecurringEvents for this user into virtual session instances
   * for the given time window [ rangeStart, rangeEnd ].
   * Only events whose RRULE produces occurrences inside the window are returned.
   */
  async materializeRecurringSessionsForRange(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<MaterializedSession[]> {
    // Fetch all recurring events whose dtstart <= rangeEnd
    const recurringEvents = await this.prisma.recurringEvent.findMany({
      where: {
        userId,
        dtstart: { lte: rangeEnd },
      },
      include: { exceptions: true },
    });

    const materialized: MaterializedSession[] = [];

    for (const event of recurringEvents) {
      // Expand occurrences using shared RRULE utility
      let occurrences: Date[];
      try {
        const exdates = event.exceptions
          .filter((ex) => ex.cancelled)
          .map((ex) => new Date(ex.originalStartTime));

        occurrences = expandRRuleForRange(
          event.rrule,
          event.dtstart,
          event.timezone,
          rangeStart,
          rangeEnd,
          exdates,
        );
      } catch {
        continue; // Skip malformed rules
      }

      for (const occurrence of occurrences) {
        const originalISO = occurrence.toISOString();

        // Check if there's an exception for this occurrence
        const exception = event.exceptions.find(
          (ex) =>
            !ex.cancelled &&
            Math.abs(new Date(ex.originalStartTime).getTime() - occurrence.getTime()) < 60_000,
        );

        materialized.push({
          id: `${event.id}_${originalISO}`,
          recurringEventId: event.id,
          originalStartTime: originalISO,
          date: exception?.newStartTime
            ? new Date(exception.newStartTime).toISOString()
            : originalISO,
          durationMinutes: exception?.durationMinutes ?? event.durationMinutes,
          type: event.type,
          category: event.category,
          notes: exception?.notes !== undefined ? exception.notes : event.notes,
          completed: exception?.completed ?? false,
          cancelled: false,
          clientId: event.clientId,
          userId: event.userId,
          linkedWorkoutId: event.linkedWorkoutId,
          recurrenceId: event.id,
          isVirtual: true,
          exceptionId: exception?.id ?? null,
        });
      }
    }

    return materialized;
  }

  /**
   * Upsert a SessionException — edit or cancel a single occurrence of a recurring event.
   */
  async upsertSessionException(userId: string, dto: UpsertSessionExceptionDto) {
    // Verify ownership of the recurring event
    const event = await this.prisma.recurringEvent.findUnique({
      where: { id: dto.recurringEventId },
    });
    if (!event) throw new NotFoundException('Recurring event not found');
    if (event.userId !== userId) throw new ForbiddenException();

    return this.prisma.sessionException.upsert({
      where: {
        recurringEventId_originalStartTime: {
          recurringEventId: dto.recurringEventId,
          originalStartTime: new Date(dto.originalStartTime),
        },
      },
      create: {
        recurringEventId: dto.recurringEventId,
        originalStartTime: new Date(dto.originalStartTime),
        cancelled: dto.cancelled ?? false,
        newStartTime: dto.newStartTime ? new Date(dto.newStartTime) : null,
        durationMinutes: dto.durationMinutes ?? null,
        notes: dto.notes ?? null,
        completed: dto.completed ?? false,
      },
      update: {
        cancelled: dto.cancelled ?? false,
        newStartTime: dto.newStartTime ? new Date(dto.newStartTime) : null,
        durationMinutes: dto.durationMinutes,
        notes: dto.notes,
        completed: dto.completed,
      },
    });
  }

  /**
   * Delete a recurring event entirely (all future instances disappear).
   */
  async removeRecurringEvent(userId: string, id: string) {
    const event = await this.prisma.recurringEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException();
    if (event.userId !== userId) throw new ForbiddenException();
    return this.prisma.recurringEvent.delete({ where: { id } });
  }

  // ═══════════════════════════════════════════════════════════
  //  COMBINED FETCH for calendar views
  // ═══════════════════════════════════════════════════════════

  /**
   * Returns all sessions (legacy eager + materialized RRULE) for a time window.
   * This is what the backoffice calendar calls.
   */
  async findAllForRange(userId: string, rangeStart: Date, rangeEnd: Date) {
    const legacySessions = await this.prisma.session.findMany({
      where: {
        userId,
        date: { gte: rangeStart, lte: rangeEnd },
      },
      include: {
        client: { select: { name: true, avatar: true } },
        workout: { select: { title: true } },
      },
      orderBy: { date: 'asc' },
    });

    // Gracefully fall back if the recurring_event table doesn't exist yet
    // (i.e. migration hasn't been run)
    let virtualSessions: MaterializedSession[] = [];
    try {
      virtualSessions = await this.materializeRecurringSessionsForRange(userId, rangeStart, rangeEnd);
    } catch (err: any) {
      // P2021 = table does not exist, ignore silently
      if (!err?.code || err.code !== 'P2021') {
        console.warn('[SessionsService] materialize skipped:', err?.message);
      }
    }

    return [...legacySessions, ...virtualSessions];
  }

  /**
   * Public endpoint: returns available time slots for the trainer's calendar.
   * Privacy-safe: only exposes free slots, not client details.
   */
  async findAvailableSlots(userId: string, rangeStart: Date, rangeEnd: Date) {
    // Load dynamic config
    const workHours = await this.settingsService.getWorkHours(userId);

    const legacySessions = await this.prisma.session.findMany({
      where: { userId, date: { gte: rangeStart, lte: rangeEnd } },
      select: { date: true, durationMinutes: true, type: true, completed: true },
    });

    let virtualSessions: MaterializedSession[] = [];
    try {
      virtualSessions = await this.materializeRecurringSessionsForRange(userId, rangeStart, rangeEnd);
    } catch {
      // Ignore — table may not exist yet
    }

    // Load availability blocks
    let blocks: { start: string; end: string }[] = [];
    try {
      blocks = await this.availabilityBlocksService.materializeBlocksForRange(userId, rangeStart, rangeEnd);
    } catch {
      // Ignore — table may not exist yet
    }

    // Merge occupied slots
    const occupied = [
      ...legacySessions.map((s) => ({
        start: new Date(s.date),
        end: new Date(new Date(s.date).getTime() + s.durationMinutes * 60_000),
      })),
      ...virtualSessions.map((s) => ({
        start: new Date(s.date),
        end: new Date(new Date(s.date).getTime() + s.durationMinutes * 60_000),
      })),
    ];

    // Blocked time ranges
    const blocked = blocks.map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }));

    const slotDuration = workHours.slotDurationMinutes;
    const slots: Array<{
      date: string;
      time: string;
      type: 'In-Person' | 'Online';
      available: boolean;
    }> = [];

    const current = new Date(rangeStart);
    while (current <= rangeEnd) {
      const dayKey = DAY_MAP[current.getDay()];
      const dayConfig = workHours[dayKey];

      if (dayConfig.enabled) {
        const [startHour, startMin] = dayConfig.start.split(':').map(Number);
        const [endHour, endMin] = dayConfig.end.split(':').map(Number);
        const dayStartMinutes = startHour * 60 + startMin;
        const dayEndMinutes = endHour * 60 + endMin;

        for (let mins = dayStartMinutes; mins + slotDuration <= dayEndMinutes + slotDuration; mins += slotDuration) {
          const slotHour = Math.floor(mins / 60);
          const slotMin = mins % 60;

          const slotStart = new Date(current);
          slotStart.setHours(slotHour, slotMin, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + slotDuration * 60_000);

          // Don't exceed the day's end time
          if (slotEnd > new Date(new Date(current).setHours(endHour, endMin, 0, 0)) && mins !== dayEndMinutes) {
            continue;
          }

          const isOccupied = occupied.some(
            (o) => slotStart < o.end && slotEnd > o.start,
          );

          const isBlocked = blocked.some(
            (b) => slotStart < b.end && slotEnd > b.start,
          );

          if (!isOccupied && !isBlocked) {
            slots.push({
              date: slotStart.toISOString().split('T')[0],
              time: `${String(slotHour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`,
              type: 'In-Person',
              available: true,
            });
          }
        }
      }
      current.setDate(current.getDate() + 1);
    }

    return slots;
  }

  // ═══════════════════════════════════════════════════════════
  //  LEGACY single-session operations (unchanged)
  // ═══════════════════════════════════════════════════════════

  async findAll(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      include: {
        client: { select: { name: true, avatar: true } },
        workout: { select: { title: true } },
      },
      orderBy: { date: 'asc' },
    });
  }

  async findOne(userId: string, id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session #${id} not found`);
    if (session.userId !== userId) throw new ForbiddenException();
    return session;
  }

  async updateWithScope(
    userId: string,
    id: string,
    data: UpdateSessionDto,
    scope: 'single' | 'future',
  ) {
    const targetSession = await this.findOne(userId, id);

    if (scope === 'single' || !targetSession.recurrenceId) {
      return this.prisma.session.update({ where: { id }, data });
    }

    if (scope === 'future') {
      const originalDate = targetSession.date;
      const futureSessions = await this.prisma.session.findMany({
        where: {
          recurrenceId: targetSession.recurrenceId,
          date: { gte: originalDate },
          userId,
        },
      });

      let timeDiff = 0;
      if (data.date) {
        const newDate = new Date(data.date);
        timeDiff = newDate.getTime() - originalDate.getTime();
      }

      return this.prisma.$transaction(
        futureSessions.map((session: Session) => {
          const updatePayload: any = { ...data };
          if (timeDiff !== 0) {
            updatePayload.date = new Date(session.date.getTime() + timeDiff);
          }
          return this.prisma.session.update({
            where: { id: session.id },
            data: updatePayload,
          });
        }),
      );
    }
  }

  async toggleComplete(userId: string, id: string) {
    const session = await this.findOne(userId, id);
    return this.prisma.session.update({
      where: { id },
      data: { completed: !session.completed },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.session.delete({ where: { id } });
  }
}