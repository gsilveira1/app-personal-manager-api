import { ConflictException } from "@nestjs/common";
import { EventStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import {
  ConflictDetectorService,
  findSlotConflict,
  overlaps,
} from "./conflict-detector.service";
import { SessionOccurrencesService } from "./session-occurrences.service";
import {
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

const at = (iso: string) => new Date(iso);
const interval = (start: string, end: string) => ({
  start: at(start),
  end: at(end),
});

describe("overlaps", () => {
  const slot = interval("2025-02-01T10:00:00Z", "2025-02-01T11:00:00Z");

  it.each([
    ["starts inside", "2025-02-01T10:30:00Z", "2025-02-01T11:30:00Z", true],
    ["ends inside", "2025-02-01T09:30:00Z", "2025-02-01T10:30:00Z", true],
    ["contains it", "2025-02-01T09:00:00Z", "2025-02-01T12:00:00Z", true],
    ["is contained", "2025-02-01T10:15:00Z", "2025-02-01T10:45:00Z", true],
    [
      "ends where it starts",
      "2025-02-01T09:00:00Z",
      "2025-02-01T10:00:00Z",
      false,
    ],
    [
      "starts where it ends",
      "2025-02-01T11:00:00Z",
      "2025-02-01T12:00:00Z",
      false,
    ],
  ])("an interval that %s → %s", (_name, start, end, expected) => {
    expect(overlaps(slot, interval(start as string, end as string))).toBe(
      expected,
    );
  });
});

describe("findSlotConflict", () => {
  const slot = interval("2025-02-01T10:00:00Z", "2025-02-01T11:00:00Z");
  const session = interval("2025-02-01T10:30:00Z", "2025-02-01T11:30:00Z");
  const block = { ...session, title: "Almoço" };

  it("returns null when nothing overlaps", () => {
    expect(findSlotConflict(slot, { sessions: [], blocks: [] })).toBeNull();
  });

  it("reports a session before a block", () => {
    expect(
      findSlotConflict(slot, { sessions: [session], blocks: [block] }),
    ).toEqual({ kind: "session" });
  });

  it("reports the block's title", () => {
    expect(findSlotConflict(slot, { sessions: [], blocks: [block] })).toEqual({
      kind: "block",
      title: "Almoço",
    });
  });
});

describe("ConflictDetectorService", () => {
  let store: FakeEventStore;
  let service: ConflictDetectorService;

  const slotStart = at("2025-02-03T10:00:00Z"); // a Monday

  beforeEach(() => {
    store = createStore();
    const prisma = store as unknown as PrismaService;
    service = new ConflictDetectorService(
      new SessionOccurrencesService(prisma),
      new AvailabilityBlocksService(prisma),
    );
  });

  describe("assertSlotFree", () => {
    it("should allow the slot when no conflicts exist", async () => {
      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).resolves.toBeUndefined();
    });

    it("should throw ConflictException when time overlaps with existing session", async () => {
      seedSession(store, { date: at("2025-02-03T10:30:00Z") });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).rejects.toThrow(
        new ConflictException(
          "Time slot is already occupied by another session",
        ),
      );
    });

    it("should allow a slot that only touches the neighbouring sessions", async () => {
      seedSession(store, { date: at("2025-02-03T09:00:00Z") });
      seedSession(store, { date: at("2025-02-03T11:00:00Z") });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).resolves.toBeUndefined();
    });

    it("should throw ConflictException when time overlaps an occurrence of a series", async () => {
      seedSeries(store, {
        date: at("2025-01-06T10:00:00Z"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).rejects.toThrow(ConflictException);
    });

    it("should throw ConflictException when time overlaps an occurrence moved into the slot", async () => {
      const series = seedSeries(store, {
        date: at("2025-01-06T15:00:00Z"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });
      seedException(store, series, "2025-02-03T15:00:00Z", {
        date: at("2025-02-03T10:15:00Z"),
      });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).rejects.toThrow(ConflictException);
    });

    it("should not conflict with a cancelled occurrence", async () => {
      const series = seedSeries(store, {
        date: at("2025-01-06T10:00:00Z"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });
      seedException(store, series, "2025-02-03T10:00:00Z", {
        status: EventStatus.CANCELLED,
      });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).resolves.toBeUndefined();
    });

    it("should not conflict with the slot an occurrence was moved away from", async () => {
      const series = seedSeries(store, {
        date: at("2025-01-06T10:00:00Z"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });
      seedException(store, series, "2025-02-03T10:00:00Z", {
        date: at("2025-02-03T16:00:00Z"),
      });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).resolves.toBeUndefined();
    });

    it("should not conflict with sessions of a soft-deleted client", async () => {
      seedSession(store, { date: slotStart, clientId: DELETED_CLIENT_ID });
      seedSeries(store, {
        date: at("2025-01-06T10:00:00Z"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        clientId: DELETED_CLIENT_ID,
      });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).resolves.toBeUndefined();
    });

    it("should not conflict with another trainer's sessions or blocks", async () => {
      seedSession(store, { date: slotStart, userId: OTHER_USER_ID });
      seedBlock(store, { date: slotStart, userId: OTHER_USER_ID });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).resolves.toBeUndefined();
    });

    it("should throw ConflictException when time overlaps with availability block", async () => {
      seedBlock(store, { date: at("2025-02-03T10:30:00Z"), title: "Almoço" });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).rejects.toThrow(
        new ConflictException(
          "Time slot is blocked by an availability block: Almoço",
        ),
      );
    });

    it("should throw ConflictException when time overlaps a recurring block", async () => {
      seedBlock(store, {
        date: at("2025-01-06T10:00:00Z"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        title: "Reunião",
      });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).rejects.toThrow(/Reunião/);
    });

    it("should name an untitled block 'Untitled'", async () => {
      seedBlock(store, { date: slotStart, title: null });

      await expect(
        service.assertSlotFree(USER_ID, slotStart, 60),
      ).rejects.toThrow(/Untitled/);
    });
  });

  describe("loadBusy", () => {
    it("should return sessions and blocks as intervals", async () => {
      seedSession(store, { date: slotStart, durationMinutes: 45 });
      seedBlock(store, {
        date: at("2025-02-03T12:00:00Z"),
        durationMinutes: 30,
        title: "Almoço",
      });

      const busy = await service.loadBusy(
        USER_ID,
        at("2025-02-03T00:00:00Z"),
        at("2025-02-03T23:59:59Z"),
      );

      expect(busy).toEqual({
        sessions: [interval("2025-02-03T10:00:00Z", "2025-02-03T10:45:00Z")],
        blocks: [
          {
            ...interval("2025-02-03T12:00:00Z", "2025-02-03T12:30:00Z"),
            title: "Almoço",
          },
        ],
      });
    });
  });
});
