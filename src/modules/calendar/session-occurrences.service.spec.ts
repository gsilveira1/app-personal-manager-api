import { Logger, UnprocessableEntityException } from "@nestjs/common";
import { EventStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
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

describe("SessionOccurrencesService", () => {
  let store: FakeEventStore;
  let service: SessionOccurrencesService;
  let errorLog: jest.SpyInstance;

  const january = [
    new Date("2025-01-01T00:00:00Z"),
    new Date("2025-01-31T23:59:59Z"),
  ] as const;

  beforeEach(() => {
    store = createStore();
    service = new SessionOccurrencesService(store as unknown as PrismaService);
    errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe("listInRange — series expansion", () => {
    it("should expand RRULE into virtual sessions within range", async () => {
      const series = seedSeries(store, { notes: "Treino A" });

      const result = await service.listInRange(USER_ID, ...january);

      // 4 Mondays in January: 6, 13, 20, 27
      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        id: `${series.id}_2025-01-06T10:00:00.000Z`,
        isVirtual: true,
        recurringEventId: series.id,
        recurrenceId: series.id,
        durationMinutes: 60,
        cancelled: false,
        completed: false,
        exceptionId: null,
        notes: "Treino A",
        clientId: CLIENT_ID,
        client: { name: "Maria Santos", avatar: null },
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      });
    });

    it("should apply cancelled exceptions (the occurrence disappears)", async () => {
      const series = seedSeries(store);
      seedException(store, series, "2025-01-13T10:00:00Z", {
        status: EventStatus.CANCELLED,
      });

      const result = await service.listInRange(USER_ID, ...january);

      expect(result).toHaveLength(3);
      const days = result.map((s) => new Date(s.date).getUTCDate());
      expect(days).toEqual([6, 20, 27]);
    });

    it("should apply rescheduled exceptions (moved, shortened, annotated, completed)", async () => {
      const series = seedSeries(store, {
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=2",
      });
      const exception = seedException(store, series, "2025-01-06T10:00:00Z", {
        date: new Date("2025-01-07T14:00:00Z"),
        durationMinutes: 45,
        notes: "Remarcado para terça",
        status: EventStatus.COMPLETED,
      });

      const result = await service.listInRange(USER_ID, ...january);

      expect(result).toHaveLength(2);
      const rescheduled = result.find((s) => s.exceptionId === exception.id);
      expect(rescheduled).toMatchObject({
        id: `${series.id}_2025-01-06T10:00:00.000Z`,
        date: "2025-01-07T14:00:00.000Z",
        originalStartTime: "2025-01-06T10:00:00.000Z",
        durationMinutes: 45,
        notes: "Remarcado para terça",
        completed: true,
        isVirtual: true,
      });
    });

    it("should return empty array when there is nothing", async () => {
      expect(
        await service.listInRange(USER_ID, new Date(), new Date()),
      ).toEqual([]);
    });

    it("should combine occurrences from multiple series", async () => {
      const mondays = seedSeries(store, {
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=2",
      });
      const wednesdays = seedSeries(store, {
        rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=2",
        date: new Date("2025-01-08T14:00:00Z"),
        durationMinutes: 45,
        sessionType: "Online",
      });

      const result = await service.listInRange(
        USER_ID,
        new Date("2025-01-01"),
        new Date("2025-01-31"),
      );

      expect(result).toHaveLength(4);
      expect(
        result.filter((s) => s.recurringEventId === mondays.id),
      ).toHaveLength(2);
      expect(
        result.filter((s) => s.recurringEventId === wednesdays.id),
      ).toHaveLength(2);
    });

    it("should leave a malformed stored rule out and log it (never a silent skip)", async () => {
      const broken = seedSeries(store, { rrule: "INVALID_RRULE_STRING" });
      seedSeries(store, { rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=1" });

      const result = await service.listInRange(USER_ID, ...january);

      expect(result).toHaveLength(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain(broken.id);
      expect(errorLog.mock.calls[0][0]).toContain("INVALID_RRULE_STRING");
    });

    it("should ignore a series that starts after the range", async () => {
      seedSeries(store, { date: new Date("2025-03-03T10:00:00Z") });

      expect(await service.listInRange(USER_ID, ...january)).toEqual([]);
    });
  });

  describe("listInRange — stored rows", () => {
    it("should merge one-off sessions and occurrences, ordered by date", async () => {
      const oneOff = seedSession(store, {
        date: new Date("2025-01-10T09:00:00Z"),
      });
      seedSeries(store, { rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=2" });

      const result = await service.listInRange(USER_ID, ...january);

      // 1 one-off + 2 virtual = 3
      expect(result).toHaveLength(3);
      expect(result.filter((s) => s.isVirtual)).toHaveLength(2);
      expect(result.map((s) => s.date)).toEqual([
        "2025-01-06T10:00:00.000Z",
        "2025-01-10T09:00:00.000Z",
        "2025-01-13T10:00:00.000Z",
      ]);
      expect(result[1]).toMatchObject({ id: oneOff.id, isVirtual: false });
    });

    it("should leave out one-off sessions outside the range", async () => {
      seedSession(store, { date: new Date("2025-02-01T10:00:00Z") });

      expect(await service.listInRange(USER_ID, ...january)).toEqual([]);
    });

    it("should never return a series master as a row", async () => {
      const series = seedSeries(store);

      const result = await service.listInRange(USER_ID, ...january);

      expect(result.map((s) => s.id)).not.toContain(series.id);
    });

    it("should not return another trainer's sessions or any block", async () => {
      seedSession(store, {
        userId: OTHER_USER_ID,
        date: new Date("2025-01-10T09:00:00Z"),
      });
      seedSeries(store, { userId: OTHER_USER_ID });
      seedBlock(store);

      expect(await service.listInRange(USER_ID, ...january)).toEqual([]);
    });

    it("should hide sessions and series of soft-deleted clients", async () => {
      seedSession(store, {
        clientId: DELETED_CLIENT_ID,
        date: new Date("2025-01-10T09:00:00Z"),
      });
      const series = seedSeries(store, { clientId: DELETED_CLIENT_ID });
      seedException(store, series, "2025-01-13T10:00:00Z", {
        date: new Date("2025-01-14T10:00:00Z"),
      });

      expect(await service.listInRange(USER_ID, ...january)).toEqual([]);
    });
  });

  describe("listInRange — an occurrence moved across the range boundary", () => {
    const moveLastJanuaryMondayToFebruary = () => {
      const series = seedSeries(store);
      const exception = seedException(store, series, "2025-01-27T10:00:00Z", {
        date: new Date("2025-02-03T15:00:00Z"),
      });
      return { series, exception };
    };

    it("should not appear in the range it left", async () => {
      moveLastJanuaryMondayToFebruary();

      const result = await service.listInRange(USER_ID, ...january);

      expect(result.map((s) => new Date(s.date).getUTCDate())).toEqual([
        6, 13, 20,
      ]);
    });

    it("should appear exactly once in the range it moved to", async () => {
      const { series, exception } = moveLastJanuaryMondayToFebruary();

      const result = await service.listInRange(
        USER_ID,
        new Date("2025-02-01T00:00:00Z"),
        new Date("2025-02-28T23:59:59Z"),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: `${series.id}_2025-01-27T10:00:00.000Z`,
        date: "2025-02-03T15:00:00.000Z",
        exceptionId: exception.id,
      });
    });

    it("should appear exactly once when the range covers both dates", async () => {
      const { exception } = moveLastJanuaryMondayToFebruary();

      const result = await service.listInRange(
        USER_ID,
        new Date("2025-01-01T00:00:00Z"),
        new Date("2025-02-28T23:59:59Z"),
      );

      expect(result).toHaveLength(4);
      expect(result.filter((s) => s.exceptionId === exception.id)).toHaveLength(
        1,
      );
    });
  });

  describe("listOneOff", () => {
    it("should return one-off sessions only, oldest first", async () => {
      const later = seedSession(store, {
        date: new Date("2025-03-01T10:00:00Z"),
      });
      const earlier = seedSession(store, {
        date: new Date("2025-02-01T10:00:00Z"),
      });
      const series = seedSeries(store);
      seedException(store, series, "2025-01-13T10:00:00Z");
      seedBlock(store);

      const result = await service.listOneOff(USER_ID);

      expect(result.map((s) => s.id)).toEqual([earlier.id, later.id]);
    });

    it("should hide sessions of soft-deleted clients and of other trainers", async () => {
      seedSession(store, { clientId: DELETED_CLIENT_ID });
      seedSession(store, { userId: OTHER_USER_ID });

      expect(await service.listOneOff(USER_ID)).toEqual([]);
    });
  });

  describe("findOccurrence", () => {
    it("should return the canonical start of an existing occurrence", () => {
      const series = seedSeries(store);

      expect(
        service.findOccurrence(series, new Date("2025-01-13T10:00:00Z")),
      ).toEqual(new Date("2025-01-13T10:00:00Z"));
    });

    it("should tolerate an id that is off by less than a minute", () => {
      const series = seedSeries(store);

      expect(
        service.findOccurrence(series, new Date("2025-01-13T10:00:30Z")),
      ).toEqual(new Date("2025-01-13T10:00:00Z"));
    });

    it("should return null where the series has no occurrence", () => {
      const series = seedSeries(store);

      expect(
        service.findOccurrence(series, new Date("2025-01-14T10:00:00Z")),
      ).toBeNull();
    });

    it("should return null and log when the stored rule is malformed", () => {
      const series = seedSeries(store, { rrule: "INVALID_RRULE_STRING" });

      expect(
        service.findOccurrence(series, new Date("2025-01-13T10:00:00Z")),
      ).toBeNull();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });
  });

  describe("bounded expansion (regression H1)", () => {
    it("should leave a stored rule outside the whitelist out and log it, without expanding it", async () => {
      const abusive = seedSeries(store, {
        rrule: "FREQ=DAILY;BYHOUR=0,1,2;BYMINUTE=0,1,2;BYSECOND=0,1,2",
      });
      seedSeries(store, { rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=1" });

      const result = await service.listInRange(USER_ID, ...january);

      expect(result).toHaveLength(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain(abusive.id);
      expect(errorLog.mock.calls[0][0]).toContain("BYHOUR");
    });

    it("should fail with 422 and log the series id when a rule exceeds the occurrence cap (never truncate)", async () => {
      const daily = seedSeries(store, { rrule: "FREQ=DAILY" });

      await expect(
        service.listInRange(
          USER_ID,
          new Date("2025-01-01T00:00:00Z"),
          new Date("2035-01-01T00:00:00Z"),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain(daily.id);
    });
  });
});
