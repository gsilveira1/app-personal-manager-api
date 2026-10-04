import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { EventStatus, EventType, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { SessionExceptionsService } from "./session-exceptions.service";
import { SessionOccurrencesService } from "./session-occurrences.service";
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

describe("SessionExceptionsService", () => {
  let store: FakeEventStore;
  let service: SessionExceptionsService;

  const SECOND_MONDAY = "2025-01-13T10:00:00.000Z";
  const ref = (seriesId: string, iso = SECOND_MONDAY) => ({
    seriesId,
    originalStartTime: new Date(iso),
  });
  const exceptionsOf = (seriesId: string) =>
    store.rows.filter((row) => row.parentEventId === seriesId);

  beforeEach(() => {
    store = createStore();
    const prisma = store as unknown as PrismaService;
    service = new SessionExceptionsService(
      prisma,
      new SessionOccurrencesService(prisma),
    );
    jest.clearAllMocks();
  });

  describe("resolve", () => {
    it("should resolve an occurrence that has no exception", async () => {
      const series = seedSeries(store);

      const resolved = await service.resolve(USER_ID, ref(series.id));

      expect(resolved.series.id).toBe(series.id);
      expect(resolved.originalStartTime.toISOString()).toBe(SECOND_MONDAY);
      expect(resolved.exception).toBeNull();
    });

    it("should return the stored exception of the occurrence", async () => {
      const series = seedSeries(store);
      const exception = seedException(store, series, SECOND_MONDAY, {
        status: EventStatus.COMPLETED,
      });

      const resolved = await service.resolve(USER_ID, ref(series.id));

      expect(resolved.exception?.id).toBe(exception.id);
      expect(resolved.originalStartTime.toISOString()).toBe(SECOND_MONDAY);
    });

    it("should snap an id that is off by seconds to the canonical start", async () => {
      const series = seedSeries(store);

      const resolved = await service.resolve(
        USER_ID,
        ref(series.id, "2025-01-13T10:00:30.000Z"),
      );

      expect(resolved.originalStartTime.toISOString()).toBe(SECOND_MONDAY);
    });

    it("should throw NotFoundException when the series does not exist", async () => {
      await expect(service.resolve(USER_ID, ref("missing"))).rejects.toThrow(
        new NotFoundException("Recurring event #missing not found"),
      );
    });

    it.each([
      ["a one-off session", () => seedSession(store)],
      ["a block", () => seedBlock(store)],
    ])("should throw NotFoundException when the id is %s", async (_n, seed) => {
      const row = seed();

      await expect(service.resolve(USER_ID, ref(row.id))).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when the id is an exception, not a series", async () => {
      const series = seedSeries(store);
      const exception = seedException(store, series, SECOND_MONDAY);

      await expect(service.resolve(USER_ID, ref(exception.id))).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when the series belongs to another user", async () => {
      const series = seedSeries(store, { userId: OTHER_USER_ID });

      await expect(service.resolve(USER_ID, ref(series.id))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should throw NotFoundException when the series' client is soft-deleted", async () => {
      const series = seedSeries(store, { clientId: DELETED_CLIENT_ID });

      await expect(service.resolve(USER_ID, ref(series.id))).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when the series has no occurrence at that time", async () => {
      const series = seedSeries(store);

      // A Tuesday: the rule only yields Mondays.
      await expect(
        service.resolve(USER_ID, ref(series.id, "2025-01-14T10:00:00.000Z")),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("upsert", () => {
    it("should retry as an update when a concurrent first edit created the exception (regression: P2002 answered 500)", async () => {
      const series = seedSeries(store);
      const occurrence = await service.resolve(USER_ID, ref(series.id));
      store.event.upsert.mockImplementationOnce(async () => {
        // The other request wins the insert between this one's lookup and its write.
        seedException(store, series, SECOND_MONDAY, { notes: "da outra" });
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
        });
      });

      const row = await service.upsert(occurrence, {
        status: EventStatus.COMPLETED,
      });

      expect(store.event.upsert).toHaveBeenCalledTimes(2);
      expect(row).toMatchObject({
        status: EventStatus.COMPLETED,
        notes: "da outra",
      });
      expect(exceptionsOf(series.id)).toHaveLength(1);
    });

    it("should propagate any other database error without retrying", async () => {
      const series = seedSeries(store);
      const occurrence = await service.resolve(USER_ID, ref(series.id));
      store.event.upsert.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        service.upsert(occurrence, { status: EventStatus.CANCELLED }),
      ).rejects.toThrow("connection lost");
      expect(store.event.upsert).toHaveBeenCalledTimes(1);
    });

    it("should create the exception with the master's fields copied", async () => {
      const series = seedSeries(store, {
        durationMinutes: 45,
        sessionType: "Online",
        category: "Check-in",
        notes: "Notas da série",
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
        timezone: "America/Bahia",
      });
      const occurrence = await service.resolve(USER_ID, ref(series.id));

      const row = await service.upsert(occurrence, {
        status: EventStatus.CANCELLED,
      });

      expect(row).toMatchObject({
        type: EventType.SESSION,
        parentEventId: series.id,
        originalStartTime: new Date(SECOND_MONDAY),
        date: new Date(SECOND_MONDAY),
        userId: USER_ID,
        clientId: CLIENT_ID,
        durationMinutes: 45,
        sessionType: "Online",
        category: "Check-in",
        timezone: "America/Bahia",
        workoutSheetId: "sheet-1",
        workoutSegmentId: "item-a",
        status: EventStatus.CANCELLED,
        rrule: null,
        // null = "use the master's notes"
        notes: null,
      });
      expect(row.parent).toEqual({
        notes: "Notas da série",
        rrule: series.rrule,
      });
    });

    it("should apply the changes over the copied fields on create", async () => {
      const series = seedSeries(store);
      const occurrence = await service.resolve(USER_ID, ref(series.id));

      const row = await service.upsert(occurrence, {
        date: new Date("2025-01-14T15:00:00Z"),
        durationMinutes: 30,
        notes: "Remarcado",
      });

      expect(row).toMatchObject({
        originalStartTime: new Date(SECOND_MONDAY),
        date: new Date("2025-01-14T15:00:00Z"),
        durationMinutes: 30,
        notes: "Remarcado",
        status: EventStatus.SCHEDULED,
      });
    });

    it("should upsert on (parentEventId, originalStartTime)", async () => {
      const series = seedSeries(store);
      const occurrence = await service.resolve(USER_ID, ref(series.id));

      await service.upsert(occurrence, { status: EventStatus.COMPLETED });

      expect(store.event.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            parentEventId_originalStartTime: {
              parentEventId: series.id,
              originalStartTime: new Date(SECOND_MONDAY),
            },
          },
        }),
      );
    });

    it("should update the existing exception instead of creating a second one", async () => {
      const series = seedSeries(store);
      const first = await service.upsert(
        await service.resolve(USER_ID, ref(series.id)),
        { date: new Date("2025-01-14T15:00:00Z"), notes: "Remarcado" },
      );

      const second = await service.upsert(
        await service.resolve(USER_ID, ref(series.id)),
        { status: EventStatus.COMPLETED },
      );

      expect(exceptionsOf(series.id)).toHaveLength(1);
      expect(second.id).toBe(first.id);
      // Fields the second change did not mention are kept.
      expect(second).toMatchObject({
        date: new Date("2025-01-14T15:00:00Z"),
        notes: "Remarcado",
        status: EventStatus.COMPLETED,
      });
    });

    it("should keep one exception when the id is off by seconds (regression: duplicate exceptions)", async () => {
      const series = seedSeries(store);
      await service.upsert(await service.resolve(USER_ID, ref(series.id)), {
        status: EventStatus.COMPLETED,
      });

      await service.upsert(
        await service.resolve(
          USER_ID,
          ref(series.id, "2025-01-13T10:00:20.000Z"),
        ),
        { status: EventStatus.SCHEDULED },
      );

      expect(exceptionsOf(series.id)).toHaveLength(1);
      expect(exceptionsOf(series.id)[0].status).toBe(EventStatus.SCHEDULED);
    });
  });
});
