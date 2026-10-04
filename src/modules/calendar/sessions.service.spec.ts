import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { EventStatus, EventType } from "@prisma/client";

import { ClientDirectory, WorkoutSheetReader } from "../../common/ports";
import { PrismaService } from "../prisma/prisma.service";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import { ConflictDetectorService } from "./conflict-detector.service";
import { CreateSessionDto } from "./dto/session.dto";
import { SessionExceptionsService } from "./session-exceptions.service";
import { SessionOccurrencesService } from "./session-occurrences.service";
import { SessionWorkoutsService } from "./session-workouts.service";
import { SessionsService } from "./sessions.service";
import {
  CLIENT_ID,
  createStore,
  DELETED_CLIENT_ID,
  OTHER_USER_ID,
  seedBlock,
  seedException,
  seedSeries,
  seedSession,
  USER_ID,
} from "./testing/calendar-fixtures";
import { FakeEventStore } from "./testing/fake-event-store";

describe("SessionsService", () => {
  let store: FakeEventStore;
  let clients: jest.Mocked<ClientDirectory>;
  let sheets: jest.Mocked<WorkoutSheetReader>;
  let service: SessionsService;

  const SECOND_MONDAY = "2025-01-13T10:00:00.000Z";
  const occurrenceId = (seriesId: string, iso = SECOND_MONDAY) =>
    `${seriesId}_${iso}`;
  const stored = (id: string) => store.rows.find((row) => row.id === id);
  const exceptionsOf = (seriesId: string) =>
    store.rows.filter((row) => row.parentEventId === seriesId);
  const january = {
    start: new Date("2025-01-01T00:00:00Z"),
    end: new Date("2025-01-31T23:59:59Z"),
  };

  const createDto = (overrides: Partial<CreateSessionDto> = {}) =>
    ({
      date: "2025-02-03T10:00:00.000Z",
      durationMinutes: 60,
      type: "In-Person",
      category: "Workout",
      clientId: CLIENT_ID,
      ...overrides,
    }) as CreateSessionDto;

  beforeEach(() => {
    store = createStore();
    const prisma = store as unknown as PrismaService;
    clients = {
      requireOwned: jest.fn().mockResolvedValue({ id: CLIENT_ID }),
      findById: jest.fn(),
      findManyOwned: jest.fn(),
      countByOwners: jest.fn(),
    };
    sheets = {
      findActiveSummaries: jest.fn(),
      resolveSegments: jest.fn().mockResolvedValue([]),
      assertSegment: jest.fn().mockResolvedValue(undefined),
    };
    const occurrences = new SessionOccurrencesService(prisma);
    service = new SessionsService(
      prisma,
      clients,
      occurrences,
      new ConflictDetectorService(
        occurrences,
        new AvailabilityBlocksService(prisma),
      ),
      new SessionExceptionsService(prisma, occurrences),
      new SessionWorkoutsService(sheets),
    );
  });

  describe("create — one-off session", () => {
    it("should create a single session", async () => {
      const result = await service.create(
        USER_ID,
        createDto({ notes: "Primeira aula" }),
      );

      expect(result).toMatchObject({
        date: "2025-02-03T10:00:00.000Z",
        durationMinutes: 60,
        type: "In-Person",
        category: "Workout",
        notes: "Primeira aula",
        status: EventStatus.SCHEDULED,
        completed: false,
        cancelled: false,
        clientId: CLIENT_ID,
        userId: USER_ID,
        client: { name: "Maria Santos", avatar: null },
        timezone: "America/Sao_Paulo",
        isVirtual: false,
        recurringEventId: null,
        rrule: null,
      });
      expect(stored(result.id)).toMatchObject({
        type: EventType.SESSION,
        rrule: null,
        parentEventId: null,
      });
      expect(clients.requireOwned).toHaveBeenCalledWith(USER_ID, CLIENT_ID);
    });

    it("should store COMPLETED when completed is sent", async () => {
      const result = await service.create(
        USER_ID,
        createDto({ completed: true }),
      );

      expect(result).toMatchObject({ status: "COMPLETED", completed: true });
    });

    it("should throw ForbiddenException when client belongs to another user", async () => {
      clients.requireOwned.mockRejectedValue(new ForbiddenException());

      await expect(service.create(USER_ID, createDto())).rejects.toThrow(
        ForbiddenException,
      );
      expect(store.rows).toHaveLength(0);
    });

    it("should throw NotFoundException when the client is missing or soft-deleted (regression: a missing client used to be accepted)", async () => {
      clients.requireOwned.mockRejectedValue(new NotFoundException());

      await expect(service.create(USER_ID, createDto())).rejects.toThrow(
        NotFoundException,
      );
      expect(store.rows).toHaveLength(0);
    });

    it("should validate the workout link through the port and resolve it in the view", async () => {
      sheets.resolveSegments.mockResolvedValue([
        { sheetId: "sheet-1", segmentId: "item-a", name: "Peito", letter: "A" },
      ]);

      const result = await service.create(
        USER_ID,
        createDto({ workoutSheetId: "sheet-1", workoutSegmentId: "item-a" }),
      );

      expect(sheets.assertSegment).toHaveBeenCalledWith(USER_ID, {
        sheetId: "sheet-1",
        segmentId: "item-a",
      });
      expect(result).toMatchObject({
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
        workout: { id: "item-a", name: "Peito", letter: "A" },
      });
    });

    it("should not create the session when the workout sheet is not the trainer's", async () => {
      sheets.assertSegment.mockRejectedValue(new NotFoundException());

      await expect(
        service.create(USER_ID, createDto({ workoutSheetId: "sheet-x" })),
      ).rejects.toThrow(NotFoundException);
      expect(store.rows).toHaveLength(0);
    });

    it("should answer 400 for a segment without a sheet", async () => {
      await expect(
        service.create(USER_ID, createDto({ workoutSegmentId: "item-a" })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("create — conflict validation", () => {
    it("should throw ConflictException when time overlaps with existing session", async () => {
      seedSession(store, { date: new Date("2025-02-03T10:30:00Z") });

      await expect(service.create(USER_ID, createDto())).rejects.toThrow(
        new ConflictException(
          "Time slot is already occupied by another session",
        ),
      );
      expect(store.rows).toHaveLength(1);
    });

    it("should throw ConflictException when time overlaps an occurrence of a series", async () => {
      seedSeries(store, { rrule: "FREQ=WEEKLY;BYDAY=MO" });

      await expect(service.create(USER_ID, createDto())).rejects.toThrow(
        ConflictException,
      );
    });

    it("should throw ConflictException when time overlaps with availability block", async () => {
      seedBlock(store, {
        date: new Date("2025-02-03T10:00:00Z"),
        title: "Almoço",
      });

      await expect(service.create(USER_ID, createDto())).rejects.toThrow(
        new ConflictException(
          "Time slot is blocked by an availability block: Almoço",
        ),
      );
    });

    it("should allow creation when no conflicts exist", async () => {
      seedSession(store, { date: new Date("2025-02-03T11:00:00Z") });

      await expect(service.create(USER_ID, createDto())).resolves.toMatchObject(
        {
          date: "2025-02-03T10:00:00.000Z",
        },
      );
    });

    it("should not conflict with a session of a soft-deleted client", async () => {
      seedSession(store, {
        date: new Date("2025-02-03T10:00:00Z"),
        clientId: DELETED_CLIENT_ID,
      });

      await expect(service.create(USER_ID, createDto())).resolves.toBeDefined();
    });
  });

  describe("create — series", () => {
    const seriesDto = (overrides: Partial<CreateSessionDto> = {}) =>
      createDto({
        date: "2025-01-06T10:00:00.000Z",
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        timezone: "America/Bahia",
        ...overrides,
      });

    it("should create a recurring event master record", async () => {
      const result = await service.create(USER_ID, seriesDto());

      expect(result).toMatchObject({
        date: "2025-01-06T10:00:00.000Z",
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        timezone: "America/Bahia",
        isVirtual: false,
      });
      expect(store.rows).toHaveLength(1);
      expect(stored(result.id)).toMatchObject({
        type: EventType.SESSION,
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        date: new Date("2025-01-06T10:00:00.000Z"),
      });
    });

    it("should default the timezone to America/Sao_Paulo", async () => {
      const result = await service.create(
        USER_ID,
        seriesDto({ timezone: undefined }),
      );

      expect(result.timezone).toBe("America/Sao_Paulo");
    });

    it("should not run the conflict check for a series", async () => {
      seedSession(store, { date: new Date("2025-01-06T10:00:00Z") });

      await expect(service.create(USER_ID, seriesDto())).resolves.toBeDefined();
    });

    it("should throw ForbiddenException when client belongs to another user", async () => {
      clients.requireOwned.mockRejectedValue(new ForbiddenException());

      await expect(service.create(USER_ID, seriesDto())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should answer 400 for a rule that does not parse", async () => {
      await expect(
        service.create(USER_ID, seriesDto({ rrule: "FREQ=SOMETIMES" })),
      ).rejects.toThrow(BadRequestException);
      expect(store.rows).toHaveLength(0);
    });

    it("should answer 400 when completed is sent with a series", async () => {
      await expect(
        service.create(USER_ID, seriesDto({ completed: true })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("findAll", () => {
    it("should return only one-off sessions when no range is given", async () => {
      const oneOff = seedSession(store);
      seedSeries(store);

      const result = await service.findAll(USER_ID);

      expect(result.map((view) => view.id)).toEqual([oneOff.id]);
    });

    it("should merge one-off sessions and occurrences for a range", async () => {
      const oneOff = seedSession(store, {
        date: new Date("2025-01-08T09:00:00Z"),
      });
      const series = seedSeries(store);

      const result = await service.findAll(USER_ID, january);

      expect(result.map((view) => view.id)).toEqual([
        occurrenceId(series.id, "2025-01-06T10:00:00.000Z"),
        oneOff.id,
        occurrenceId(series.id, "2025-01-13T10:00:00.000Z"),
        occurrenceId(series.id, "2025-01-20T10:00:00.000Z"),
        occurrenceId(series.id, "2025-01-27T10:00:00.000Z"),
      ]);
    });

    it("should hide sessions of soft-deleted clients", async () => {
      seedSession(store, {
        date: new Date("2025-01-08T09:00:00Z"),
        clientId: DELETED_CLIENT_ID,
      });
      seedSeries(store, { clientId: DELETED_CLIENT_ID });

      expect(await service.findAll(USER_ID, january)).toEqual([]);
      expect(await service.findAll(USER_ID)).toEqual([]);
    });

    it("should fill workout with one resolveSegments call per request", async () => {
      seedSession(store, {
        date: new Date("2025-01-08T09:00:00Z"),
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-b",
      });
      seedSeries(store, {
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
      });
      sheets.resolveSegments.mockResolvedValue([
        { sheetId: "sheet-1", segmentId: "item-a", name: "Peito", letter: "A" },
      ]);

      const result = await service.findAll(USER_ID, january);

      expect(sheets.resolveSegments).toHaveBeenCalledTimes(1);
      const workouts = result.map((view) => view.workout?.letter ?? null);
      // The unresolved pointer (item-b) reads as "no workout linked".
      expect(workouts).toEqual(["A", null, "A", "A", "A"]);
    });

    it("should propagate a database failure instead of returning a partial list (regression: P2021 was swallowed)", async () => {
      store.event.findMany.mockRejectedValueOnce(
        Object.assign(new Error("table does not exist"), { code: "P2021" }),
      );

      await expect(service.findAll(USER_ID, january)).rejects.toThrow(
        "table does not exist",
      );
    });
  });

  describe("findOne", () => {
    it("should return session when found and owned", async () => {
      const session = seedSession(store);

      await expect(service.findOne(USER_ID, session.id)).resolves.toMatchObject(
        {
          id: session.id,
          isVirtual: false,
        },
      );
    });

    it("should throw NotFoundException when session does not exist", async () => {
      await expect(service.findOne(USER_ID, "missing")).rejects.toThrow(
        new NotFoundException("Session #missing not found"),
      );
    });

    it("should throw ForbiddenException when session belongs to another user", async () => {
      const session = seedSession(store, { userId: OTHER_USER_ID });

      await expect(service.findOne(USER_ID, session.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should throw NotFoundException for a session of a soft-deleted client", async () => {
      const session = seedSession(store, { clientId: DELETED_CLIENT_ID });

      await expect(service.findOne(USER_ID, session.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when the id is a block", async () => {
      const block = seedBlock(store);

      await expect(service.findOne(USER_ID, block.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return a virtual occurrence by its occurrence id", async () => {
      const series = seedSeries(store, { notes: "Treino A" });

      const result = await service.findOne(USER_ID, occurrenceId(series.id));

      expect(result).toMatchObject({
        id: occurrenceId(series.id),
        date: SECOND_MONDAY,
        originalStartTime: SECOND_MONDAY,
        isVirtual: true,
        recurringEventId: series.id,
        exceptionId: null,
        notes: "Treino A",
      });
    });

    it("should return the exception's values for an edited occurrence", async () => {
      const series = seedSeries(store);
      const exception = seedException(store, series, SECOND_MONDAY, {
        date: new Date("2025-01-14T15:00:00Z"),
        status: EventStatus.COMPLETED,
      });

      const result = await service.findOne(USER_ID, occurrenceId(series.id));

      expect(result).toMatchObject({
        id: occurrenceId(series.id),
        date: "2025-01-14T15:00:00.000Z",
        originalStartTime: SECOND_MONDAY,
        completed: true,
        exceptionId: exception.id,
      });
    });

    it("should present an exception addressed by its UUID as the occurrence", async () => {
      const series = seedSeries(store);
      const exception = seedException(store, series, SECOND_MONDAY);

      const result = await service.findOne(USER_ID, exception.id);

      expect(result).toMatchObject({
        id: occurrenceId(series.id),
        exceptionId: exception.id,
      });
    });

    it("should throw NotFoundException if virtual session recurring event does not exist", async () => {
      await expect(
        service.findOne(USER_ID, occurrenceId("missing")),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if virtual session belongs to another user", async () => {
      const series = seedSeries(store, { userId: OTHER_USER_ID });

      await expect(
        service.findOne(USER_ID, occurrenceId(series.id)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should answer 400 for a malformed occurrence id", async () => {
      await expect(
        service.findOne(USER_ID, "series_not-a-date"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("update — one-off session", () => {
    it("should update the stored session", async () => {
      const session = seedSession(store);

      const result = await service.update(USER_ID, session.id, {
        date: "2025-02-02T15:00:00.000Z",
        durationMinutes: 45,
        type: "Online",
        category: "Check-in",
        notes: "Remarcada",
      });

      expect(result).toMatchObject({
        id: session.id,
        date: "2025-02-02T15:00:00.000Z",
        durationMinutes: 45,
        type: "Online",
        category: "Check-in",
        notes: "Remarcada",
      });
      expect(stored(session.id)).toMatchObject({
        sessionType: "Online",
        durationMinutes: 45,
      });
    });

    it("should leave untouched what the body does not mention", async () => {
      const session = seedSession(store, {
        notes: "Manter",
        status: EventStatus.COMPLETED,
      });

      const result = await service.update(USER_ID, session.id, {
        durationMinutes: 30,
      });

      expect(result).toMatchObject({
        notes: "Manter",
        completed: true,
        date: "2025-02-01T10:00:00.000Z",
      });
    });

    it("should map completed to the status", async () => {
      const session = seedSession(store);

      const done = await service.update(USER_ID, session.id, {
        completed: true,
      });
      expect(done).toMatchObject({ status: "COMPLETED", completed: true });

      const undone = await service.update(USER_ID, session.id, {
        completed: false,
      });
      expect(undone).toMatchObject({ status: "SCHEDULED", completed: false });
    });

    it("should answer 400 when a one-off session is sent cancelled: true", async () => {
      const session = seedSession(store);

      await expect(
        service.update(USER_ID, session.id, { cancelled: true }),
      ).rejects.toThrow(BadRequestException);
      expect(stored(session.id)?.status).toBe(EventStatus.SCHEDULED);
    });

    it("should validate a new workout link and store it", async () => {
      const session = seedSession(store);

      await service.update(USER_ID, session.id, {
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
      });

      expect(sheets.assertSegment).toHaveBeenCalledWith(USER_ID, {
        sheetId: "sheet-1",
        segmentId: "item-a",
      });
      expect(stored(session.id)).toMatchObject({
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
      });
    });

    it("should clear the segment when the sheet is unlinked", async () => {
      const session = seedSession(store, {
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
      });

      await service.update(USER_ID, session.id, { workoutSheetId: null });

      expect(stored(session.id)).toMatchObject({
        workoutSheetId: null,
        workoutSegmentId: null,
      });
      expect(sheets.assertSegment).not.toHaveBeenCalled();
    });

    it("should not update when the new sheet is not the trainer's", async () => {
      const session = seedSession(store);
      sheets.assertSegment.mockRejectedValue(new NotFoundException());

      await expect(
        service.update(USER_ID, session.id, { workoutSheetId: "sheet-x" }),
      ).rejects.toThrow(NotFoundException);
      expect(stored(session.id)?.workoutSheetId).toBeNull();
    });

    it("should throw ForbiddenException when session belongs to another user", async () => {
      const session = seedSession(store, { userId: OTHER_USER_ID });

      await expect(
        service.update(USER_ID, session.id, { notes: "x" }),
      ).rejects.toThrow(ForbiddenException);
      expect(stored(session.id)?.notes).toBeNull();
    });

    it("should throw NotFoundException when session does not exist", async () => {
      await expect(
        service.update(USER_ID, "missing", { notes: "x" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("update — series master", () => {
    it("should answer 400: editing a whole series is not supported", async () => {
      const series = seedSeries(store);

      await expect(
        service.update(USER_ID, series.id, { durationMinutes: 30 }),
      ).rejects.toThrow(BadRequestException);
      expect(stored(series.id)?.durationMinutes).toBe(60);
    });
  });

  describe("update — occurrence of a series", () => {
    it("should upsert a session exception for cancellation", async () => {
      const series = seedSeries(store);

      const result = await service.update(USER_ID, occurrenceId(series.id), {
        cancelled: true,
      });

      expect(result).toMatchObject({
        id: occurrenceId(series.id),
        status: "CANCELLED",
        cancelled: true,
      });
      expect(exceptionsOf(series.id)).toHaveLength(1);
      expect(exceptionsOf(series.id)[0]).toMatchObject({
        originalStartTime: new Date(SECOND_MONDAY),
        status: EventStatus.CANCELLED,
        clientId: CLIENT_ID,
      });
    });

    it("should make a cancelled occurrence disappear from the list", async () => {
      const series = seedSeries(store);

      await service.update(USER_ID, occurrenceId(series.id), {
        cancelled: true,
      });

      const days = (await service.findAll(USER_ID, january)).map((view) =>
        new Date(view.date).getUTCDate(),
      );
      expect(days).toEqual([6, 20, 27]);
    });

    it("should restore a cancelled occurrence with cancelled: false", async () => {
      const series = seedSeries(store);
      await service.update(USER_ID, occurrenceId(series.id), {
        cancelled: true,
      });

      const result = await service.update(USER_ID, occurrenceId(series.id), {
        cancelled: false,
      });

      expect(result).toMatchObject({ status: "SCHEDULED", cancelled: false });
      expect(await service.findAll(USER_ID, january)).toHaveLength(4);
    });

    it("should move one occurrence and keep the rest of the series", async () => {
      const series = seedSeries(store, { notes: "Notas da série" });

      const result = await service.update(USER_ID, occurrenceId(series.id), {
        date: "2025-01-14T15:00:00.000Z",
        durationMinutes: 30,
      });

      expect(result).toMatchObject({
        id: occurrenceId(series.id),
        date: "2025-01-14T15:00:00.000Z",
        originalStartTime: SECOND_MONDAY,
        durationMinutes: 30,
        // No note on the exception: the master's is shown.
        notes: "Notas da série",
        isVirtual: true,
      });
      const dates = (await service.findAll(USER_ID, january)).map(
        (view) => view.date,
      );
      expect(dates).toEqual([
        "2025-01-06T10:00:00.000Z",
        "2025-01-14T15:00:00.000Z",
        "2025-01-20T10:00:00.000Z",
        "2025-01-27T10:00:00.000Z",
      ]);
    });

    it("should update the same exception on a second edit", async () => {
      const series = seedSeries(store);
      await service.update(USER_ID, occurrenceId(series.id), {
        date: "2025-01-14T15:00:00.000Z",
      });

      const result = await service.update(USER_ID, occurrenceId(series.id), {
        completed: true,
        notes: "Feito",
      });

      expect(exceptionsOf(series.id)).toHaveLength(1);
      expect(result).toMatchObject({
        date: "2025-01-14T15:00:00.000Z",
        completed: true,
        notes: "Feito",
      });
    });

    it("should link a workout to one occurrence only", async () => {
      const series = seedSeries(store);

      await service.update(USER_ID, occurrenceId(series.id), {
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
      });

      expect(exceptionsOf(series.id)[0]).toMatchObject({
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
      });
      expect(stored(series.id)?.workoutSheetId).toBeNull();
    });

    it("should throw NotFoundException when recurring event does not exist", async () => {
      await expect(
        service.update(USER_ID, occurrenceId("missing"), { cancelled: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when event belongs to another user", async () => {
      const series = seedSeries(store, { userId: OTHER_USER_ID });

      await expect(
        service.update(USER_ID, occurrenceId(series.id), { cancelled: true }),
      ).rejects.toThrow(ForbiddenException);
      expect(exceptionsOf(series.id)).toHaveLength(0);
    });

    it("should throw NotFoundException for a date the series does not produce (regression: orphan exceptions)", async () => {
      const series = seedSeries(store);

      await expect(
        service.update(
          USER_ID,
          occurrenceId(series.id, "2025-01-14T10:00:00.000Z"),
          { cancelled: true },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(exceptionsOf(series.id)).toHaveLength(0);
    });
  });

  describe("toggleComplete", () => {
    it("should flip completed from false to true for a one-off session", async () => {
      const session = seedSession(store);

      const result = await service.toggleComplete(USER_ID, session.id);

      expect(result).toMatchObject({ status: "COMPLETED", completed: true });
      expect(stored(session.id)?.status).toBe(EventStatus.COMPLETED);
    });

    it("should flip completed from true to false for a one-off session", async () => {
      const session = seedSession(store, { status: EventStatus.COMPLETED });

      const result = await service.toggleComplete(USER_ID, session.id);

      expect(result).toMatchObject({ status: "SCHEDULED", completed: false });
    });

    it("should toggle completed on virtual recurring session by upserting the exception", async () => {
      const series = seedSeries(store);

      const result = await service.toggleComplete(
        USER_ID,
        occurrenceId(series.id),
      );

      expect(result).toMatchObject({
        id: occurrenceId(series.id),
        completed: true,
        isVirtual: true,
        recurringEventId: series.id,
      });
      expect(exceptionsOf(series.id)).toHaveLength(1);
      expect(result.exceptionId).toBe(exceptionsOf(series.id)[0].id);
    });

    it("should toggle completed from true to false on virtual session with existing exception", async () => {
      const series = seedSeries(store);
      seedException(store, series, SECOND_MONDAY, {
        status: EventStatus.COMPLETED,
        date: new Date("2025-01-14T15:00:00Z"),
      });

      const result = await service.toggleComplete(
        USER_ID,
        occurrenceId(series.id),
      );

      expect(result).toMatchObject({
        completed: false,
        status: "SCHEDULED",
        // The move stored on the exception survives the toggle.
        date: "2025-01-14T15:00:00.000Z",
      });
      expect(exceptionsOf(series.id)).toHaveLength(1);
    });

    it("should answer 400 for a cancelled occurrence", async () => {
      const series = seedSeries(store);
      seedException(store, series, SECOND_MONDAY, {
        status: EventStatus.CANCELLED,
      });

      await expect(
        service.toggleComplete(USER_ID, occurrenceId(series.id)),
      ).rejects.toThrow(BadRequestException);
      expect(exceptionsOf(series.id)[0].status).toBe(EventStatus.CANCELLED);
    });

    it("should answer 400 for a series master", async () => {
      const series = seedSeries(store);

      await expect(service.toggleComplete(USER_ID, series.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw NotFoundException if virtual session recurring event does not exist", async () => {
      await expect(
        service.toggleComplete(USER_ID, occurrenceId("missing")),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if virtual session belongs to another user", async () => {
      const series = seedSeries(store, { userId: OTHER_USER_ID });

      await expect(
        service.toggleComplete(USER_ID, occurrenceId(series.id)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("remove", () => {
    it("should delete session after ownership check", async () => {
      const session = seedSession(store);

      await expect(
        service.remove(USER_ID, session.id),
      ).resolves.toBeUndefined();

      expect(stored(session.id)).toBeUndefined();
    });

    it("should not delete another trainer's session", async () => {
      const session = seedSession(store, { userId: OTHER_USER_ID });

      await expect(service.remove(USER_ID, session.id)).rejects.toThrow(
        ForbiddenException,
      );
      expect(stored(session.id)).toBeDefined();
    });

    it("should throw NotFoundException when the session does not exist", async () => {
      await expect(service.remove(USER_ID, "missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should not delete a block through the session route", async () => {
      const block = seedBlock(store);

      await expect(service.remove(USER_ID, block.id)).rejects.toThrow(
        NotFoundException,
      );
      expect(stored(block.id)).toBeDefined();
    });

    it("should cancel occurrence of recurring event when removing virtual session", async () => {
      const series = seedSeries(store);

      await service.remove(USER_ID, occurrenceId(series.id));

      expect(stored(series.id)).toBeDefined();
      expect(exceptionsOf(series.id)).toHaveLength(1);
      expect(exceptionsOf(series.id)[0]).toMatchObject({
        originalStartTime: new Date(SECOND_MONDAY),
        status: EventStatus.CANCELLED,
      });
      expect(await service.findAll(USER_ID, january)).toHaveLength(3);
    });

    it("should keep the edits of an occurrence that is cancelled afterwards", async () => {
      const series = seedSeries(store);
      seedException(store, series, SECOND_MONDAY, { notes: "Anotação" });

      await service.remove(USER_ID, occurrenceId(series.id));

      expect(exceptionsOf(series.id)).toHaveLength(1);
      expect(exceptionsOf(series.id)[0]).toMatchObject({
        notes: "Anotação",
        status: EventStatus.CANCELLED,
      });
    });

    it("should delete entire recurring series with its exceptions", async () => {
      const series = seedSeries(store);
      seedException(store, series, SECOND_MONDAY, {
        status: EventStatus.COMPLETED,
      });
      const other = seedSession(store);

      await service.remove(USER_ID, series.id);

      expect(store.rows.map((row) => row.id)).toEqual([other.id]);
      expect(await service.findAll(USER_ID, january)).toEqual([]);
    });

    it("should throw ForbiddenException when the series belongs to another user", async () => {
      const series = seedSeries(store, { userId: OTHER_USER_ID });

      await expect(service.remove(USER_ID, series.id)).rejects.toThrow(
        ForbiddenException,
      );
      expect(stored(series.id)).toBeDefined();
    });
  });

  describe("create — double booking (regression L7: the check and the insert were not atomic)", () => {
    it("should let exactly one of two concurrent requests for the same slot through", async () => {
      const results = await Promise.allSettled([
        service.create(USER_ID, createDto()),
        service.create(USER_ID, createDto()),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const rejected = results.find((result) => result.status === "rejected");
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );
      expect(store.rows).toHaveLength(1);
    });

    it("should take the lock of (trainer, day) first, then check and insert inside the same transaction", async () => {
      await service.create(USER_ID, createDto());

      expect(store.$transaction).toHaveBeenCalledTimes(1);
      expect(store.$executeRaw).toHaveBeenCalledTimes(1);
      const [sql, key] = store.$executeRaw.mock.calls[0];
      expect(sql.join("?")).toContain("pg_advisory_xact_lock");
      expect(key).toContain(USER_ID);
      const order = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];
      expect(order(store.$executeRaw)).toBeLessThan(
        order(store.tx.event.findMany),
      );
      expect(order(store.tx.event.findMany)).toBeLessThan(
        order(store.tx.event.create),
      );
      // every read of the conflict check went through the transaction client
      expect(store.tx.event.findMany.mock.calls.length).toBe(
        store.event.findMany.mock.calls.length,
      );
      expect(store.tx.event.create).toHaveBeenCalledTimes(1);
    });

    it("should use one lock per trainer and day: the same key for the same day, another for another day or trainer", async () => {
      const keyOf = async (userId: string, date: string) => {
        store.$executeRaw.mockClear();
        await service.create(userId, createDto({ date }));
        return store.$executeRaw.mock.calls[0][1] as string;
      };

      const morning = await keyOf(USER_ID, "2025-02-03T12:00:00.000Z");
      const afternoon = await keyOf(USER_ID, "2025-02-03T15:00:00.000Z");
      const nextDay = await keyOf(USER_ID, "2025-02-04T12:00:00.000Z");
      const other = await keyOf(OTHER_USER_ID, "2025-02-03T12:00:00.000Z");

      expect(afternoon).toBe(morning);
      expect(nextDay).not.toBe(morning);
      expect(other).not.toBe(morning);
    });

    it("should not open a transaction for a series (it is not conflict-checked)", async () => {
      await service.create(
        USER_ID,
        createDto({ rrule: "FREQ=WEEKLY;BYDAY=MO" }),
      );

      expect(store.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("owner in the write (regression L1: the write used to filter by id only)", () => {
    it("should update a one-off session with the owner in the where", async () => {
      const session = seedSession(store);

      await service.update(USER_ID, session.id, { notes: "Nova" });

      expect(store.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: session.id, userId: USER_ID } }),
      );
    });

    it("should toggle a one-off session with the owner in the where", async () => {
      const session = seedSession(store);

      await service.toggleComplete(USER_ID, session.id);

      expect(store.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: session.id, userId: USER_ID } }),
      );
    });

    it("should delete with the owner in the where", async () => {
      const session = seedSession(store);

      await service.remove(USER_ID, session.id);

      expect(store.event.delete).toHaveBeenCalledWith({
        where: { id: session.id, userId: USER_ID },
      });
    });

    it.each([
      ["update", (id: string) => service.update(USER_ID, id, { notes: "x" })],
      ["remove", (id: string) => service.remove(USER_ID, id)],
    ])(
      "should answer 404 and write nothing when the session changes owner between the check and the %s",
      async (_label, write) => {
        const session = seedSession(store);
        store.event.findFirst.mockResolvedValueOnce({
          ...session,
          client: { name: "Maria Santos", avatar: null },
          parent: null,
        });
        session.userId = OTHER_USER_ID;

        await expect(write(session.id)).rejects.toThrow(NotFoundException);
        expect(store.rows).toEqual([
          expect.objectContaining({ id: session.id, notes: null }),
        ]);
      },
    );
  });

  describe("create — rule whitelist (regression H1)", () => {
    it("should answer 400 and store nothing for a rule with a sub-daily BY* part", async () => {
      await expect(
        service.create(
          USER_ID,
          createDto({
            rrule: "FREQ=DAILY;BYHOUR=0,1;BYMINUTE=0,1;BYSECOND=0,1",
          }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(store.rows).toHaveLength(0);
    });
  });
});
