import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventStatus, EventType, Prisma } from "@prisma/client";

import { CLIENT_DIRECTORY, ClientDirectory } from "../../common/ports";
import { WITHOUT_DELETED_CLIENT } from "../../common/prisma/soft-delete";
import { PrismaService } from "../prisma/prisma.service";
import {
  DEFAULT_TIMEZONE,
  SESSION_INCLUDE,
  SessionRow,
  SessionView,
} from "./calendar.types";
import { ConflictDetectorService } from "./conflict-detector.service";
import { DateRange } from "./date-range";
import { CreateSessionDto, UpdateSessionDto } from "./dto/session.dto";
import { parseEventId } from "./event-id";
import { ownedWrite } from "./owned-write";
import { assertValidRRule } from "./rrule-expander";
import {
  ResolvedOccurrence,
  SessionChanges,
  SessionExceptionsService,
} from "./session-exceptions.service";
import { SessionOccurrencesService } from "./session-occurrences.service";
import {
  nextStatus,
  toggledStatus,
  toStoredView,
  toVirtualView,
} from "./session-view";
import { SessionWorkoutsService } from "./session-workouts.service";

/** What `:id` addresses in `/sessions/:id`. */
type SessionTarget =
  | { kind: "one-off"; row: SessionRow }
  | { kind: "series"; row: SessionRow }
  | { kind: "occurrence"; occurrence: ResolvedOccurrence };

type CurrentState = Pick<
  SessionRow,
  "status" | "workoutSheetId" | "workoutSegmentId"
>;

const SERIES_NOT_EDITABLE =
  "Editing a whole series is not supported; delete it and create a new one";

/**
 * Use cases of the `/sessions` endpoints. Expansion, conflicts, exceptions and the
 * workout link live in their own collaborators; this class only orchestrates them.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
    private readonly occurrences: SessionOccurrencesService,
    private readonly conflicts: ConflictDetectorService,
    private readonly exceptions: SessionExceptionsService,
    private readonly workouts: SessionWorkoutsService,
  ) {}

  /**
   * Creates a one-off session (conflict-checked) or, with `rrule`, a series master.
   *
   * @example
   * await sessions.create(userId, { date: "2025-02-01T10:00:00Z", durationMinutes: 60, type: "In-Person", category: "Workout", clientId });
   *
   * @throws {NotFoundException} When the client or the workout sheet does not exist
   * @throws {ForbiddenException} When the client belongs to another trainer
   * @throws {BadRequestException} When the rule or the workout link is invalid
   * @throws {ConflictException} When a one-off session overlaps a session or a block
   */
  async create(userId: string, dto: CreateSessionDto): Promise<SessionView> {
    await this.clients.requireOwned(userId, dto.clientId);
    await this.workouts.assertLink(
      userId,
      dto.workoutSheetId ?? null,
      dto.workoutSegmentId ?? null,
    );

    const date = new Date(dto.date);
    const data = {
      type: EventType.SESSION,
      userId,
      clientId: dto.clientId,
      date,
      durationMinutes: dto.durationMinutes,
      sessionType: dto.type,
      category: dto.category,
      notes: dto.notes ?? null,
      status: dto.completed ? EventStatus.COMPLETED : EventStatus.SCHEDULED,
      rrule: dto.rrule ?? null,
      timezone: dto.timezone ?? DEFAULT_TIMEZONE,
      workoutSheetId: dto.workoutSheetId ?? null,
      workoutSegmentId: dto.workoutSegmentId ?? null,
    };

    if (dto.rrule) this.assertSeriesBody(dto.rrule, date, dto);
    const row = dto.rrule
      ? await this.prisma.event.create({ data, include: SESSION_INCLUDE })
      : await this.bookOneOff(data);
    return this.present(userId, toStoredView(row));
  }

  /**
   * Conflict check and insert as one unit: both run in a transaction that holds the
   * advisory lock of (trainer, day), so two requests for the same slot cannot both pass
   * the check before either inserts.
   *
   * @throws {ConflictException} When the slot overlaps a session or a block
   */
  private bookOneOff(
    data: Prisma.EventUncheckedCreateInput & {
      userId: string;
      date: Date;
      durationMinutes: number;
    },
  ): Promise<SessionRow> {
    return this.prisma.$transaction(async (tx) => {
      await this.conflicts.lockDay(tx, data.userId, data.date);
      await this.conflicts.assertSlotFree(
        data.userId,
        data.date,
        data.durationMinutes,
        tx,
      );
      return tx.event.create({ data, include: SESSION_INCLUDE });
    });
  }

  /**
   * With a range: everything the calendar shows in it. Without: one-off sessions only
   * (the client app's initial load).
   */
  async findAll(userId: string, range?: DateRange): Promise<SessionView[]> {
    const views = range
      ? await this.occurrences.listInRange(userId, range.start, range.end)
      : await this.occurrences.listOneOff(userId);
    return this.workouts.attach(userId, views);
  }

  /**
   * @throws {NotFoundException} When the session, series or occurrence does not exist
   * @throws {ForbiddenException} When it belongs to another trainer
   */
  async findOne(userId: string, id: string): Promise<SessionView> {
    const target = await this.resolveTarget(userId, id);
    if (target.kind !== "occurrence") {
      return this.present(userId, toStoredView(target.row));
    }
    const { exception, series, originalStartTime } = target.occurrence;
    return this.present(
      userId,
      exception
        ? toStoredView(exception)
        : toVirtualView(series, originalStartTime),
    );
  }

  /**
   * Updates a one-off session, or upserts the exception of one occurrence.
   *
   * @throws {BadRequestException} When `:id` is a series master, a one-off session is
   * sent `cancelled: true`, or the workout link is invalid
   * @throws {NotFoundException} When the session or the workout sheet does not exist
   * @throws {ForbiddenException} When the session belongs to another trainer
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateSessionDto,
  ): Promise<SessionView> {
    const target = await this.resolveTarget(userId, id);
    if (target.kind === "series") {
      throw new BadRequestException(SERIES_NOT_EDITABLE);
    }
    if (target.kind === "occurrence") {
      const { exception, series } = target.occurrence;
      const changes = await this.buildChanges(userId, dto, {
        status: exception?.status ?? EventStatus.SCHEDULED,
        workoutSheetId: (exception ?? series).workoutSheetId,
        workoutSegmentId: (exception ?? series).workoutSegmentId,
      });
      return this.saveException(userId, target.occurrence, changes);
    }

    if (dto.cancelled === true) {
      throw new BadRequestException(
        "A one-off session cannot be cancelled; delete it instead",
      );
    }
    const changes = await this.buildChanges(userId, dto, target.row);
    return this.saveOneOff(userId, target.row.id, changes);
  }

  /**
   * SCHEDULED ↔ COMPLETED for a one-off session or one occurrence of a series.
   *
   * @throws {BadRequestException} When `:id` is a series master or a cancelled occurrence
   * @throws {NotFoundException} When the session does not exist
   * @throws {ForbiddenException} When it belongs to another trainer
   */
  async toggleComplete(userId: string, id: string): Promise<SessionView> {
    const target = await this.resolveTarget(userId, id);
    if (target.kind === "series") {
      throw new BadRequestException(
        "A series cannot be completed; complete one of its occurrences",
      );
    }
    if (target.kind === "one-off") {
      const status = toggledStatus(target.row.status);
      return this.saveOneOff(userId, target.row.id, { status });
    }

    const current = target.occurrence.exception?.status;
    if (current === EventStatus.CANCELLED) {
      throw new BadRequestException(
        "A cancelled occurrence cannot be completed; restore it first",
      );
    }
    const status = toggledStatus(current ?? EventStatus.SCHEDULED);
    return this.saveException(userId, target.occurrence, { status });
  }

  /**
   * Deletes a one-off session or a whole series (its exceptions cascade); for an
   * occurrence, stores a CANCELLED exception.
   *
   * @throws {NotFoundException} When the session does not exist
   * @throws {ForbiddenException} When it belongs to another trainer
   */
  async remove(userId: string, id: string): Promise<void> {
    const target = await this.resolveTarget(userId, id);
    if (target.kind === "occurrence") {
      await this.exceptions.upsert(target.occurrence, {
        status: EventStatus.CANCELLED,
      });
      return;
    }
    await ownedWrite(
      this.prisma.event.delete({ where: { id: target.row.id, userId } }),
      `Session #${target.row.id} not found`,
    );
  }

  private assertSeriesBody(
    rrule: string,
    dtstart: Date,
    dto: CreateSessionDto,
  ): void {
    assertValidRRule(rrule, dtstart);
    if (dto.completed) {
      throw new BadRequestException(
        "completed cannot be set on a series; complete its occurrences",
      );
    }
  }

  private async resolveTarget(
    userId: string,
    id: string,
  ): Promise<SessionTarget> {
    const parsed = parseEventId(id);
    if (parsed.kind === "occurrence") {
      const occurrence = await this.exceptions.resolve(userId, parsed);
      return { kind: "occurrence", occurrence };
    }

    const row = await this.loadStored(userId, parsed.id);
    if (row.parentEventId && row.originalStartTime) {
      const occurrence = await this.exceptions.resolve(userId, {
        seriesId: row.parentEventId,
        originalStartTime: row.originalStartTime,
      });
      return { kind: "occurrence", occurrence };
    }
    return { kind: row.rrule ? "series" : "one-off", row };
  }

  private async loadStored(userId: string, id: string): Promise<SessionRow> {
    const row = await this.prisma.event.findFirst({
      where: { id, type: EventType.SESSION, ...WITHOUT_DELETED_CLIENT },
      include: SESSION_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Session #${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return row;
  }

  private async buildChanges(
    userId: string,
    dto: UpdateSessionDto,
    current: CurrentState,
  ): Promise<SessionChanges> {
    return {
      ...(dto.date !== undefined && { date: new Date(dto.date) }),
      ...(dto.durationMinutes !== undefined && {
        durationMinutes: dto.durationMinutes,
      }),
      ...(dto.type !== undefined && { sessionType: dto.type }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(await this.buildLinkChanges(userId, dto, current)),
      status: nextStatus(current.status, dto),
    };
  }

  /** Unlinking the sheet also clears the segment; a new link is validated first. */
  private async buildLinkChanges(
    userId: string,
    dto: UpdateSessionDto,
    current: CurrentState,
  ): Promise<Pick<SessionChanges, "workoutSheetId" | "workoutSegmentId">> {
    if (
      dto.workoutSheetId === undefined &&
      dto.workoutSegmentId === undefined
    ) {
      return {};
    }
    const workoutSheetId =
      dto.workoutSheetId !== undefined
        ? dto.workoutSheetId
        : current.workoutSheetId;
    const keptSegment = workoutSheetId ? current.workoutSegmentId : null;
    const workoutSegmentId =
      dto.workoutSegmentId !== undefined ? dto.workoutSegmentId : keptSegment;

    await this.workouts.assertLink(userId, workoutSheetId, workoutSegmentId);
    return { workoutSheetId, workoutSegmentId };
  }

  private async saveOneOff(
    userId: string,
    id: string,
    changes: SessionChanges,
  ): Promise<SessionView> {
    const row = await ownedWrite(
      this.prisma.event.update({
        where: { id, userId },
        data: changes,
        include: SESSION_INCLUDE,
      }),
      `Session #${id} not found`,
    );
    return this.present(userId, toStoredView(row));
  }

  private async saveException(
    userId: string,
    occurrence: ResolvedOccurrence,
    changes: SessionChanges,
  ): Promise<SessionView> {
    const row = await this.exceptions.upsert(occurrence, changes);
    return this.present(userId, toStoredView(row));
  }

  private async present(
    userId: string,
    view: SessionView,
  ): Promise<SessionView> {
    const [withWorkout] = await this.workouts.attach(userId, [view]);
    return withWorkout;
  }
}
