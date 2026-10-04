import { NotFoundException } from "@nestjs/common";
import { EventStatus } from "@prisma/client";

import { UserDirectory } from "../../common/ports";
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_WORK_HOURS,
  WorkHoursConfig,
} from "../../common/types/user-settings";
import { PrismaService } from "../prisma/prisma.service";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import { ConflictDetectorService } from "./conflict-detector.service";
import { PublicAvailabilityService } from "./public-availability.service";
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

describe("PublicAvailabilityService", () => {
  const SLUG = "ana-silva";
  let store: FakeEventStore;
  let users: jest.Mocked<UserDirectory>;
  let service: PublicAvailabilityService;

  // Local dates, as the slot algorithm works on the server's local days.
  const monday = () => new Date(2025, 0, 6);
  const mondayAt = (hour: number, minute = 0) =>
    new Date(2025, 0, 6, hour, minute, 0, 0);
  const day = (date: Date) => ({ start: date, end: new Date(date) });

  const useWorkHours = (overrides: Partial<WorkHoursConfig>) =>
    users.getSettings.mockResolvedValue({
      ...DEFAULT_USER_SETTINGS,
      workHours: { ...DEFAULT_WORK_HOURS, ...overrides },
    });

  const times = async () =>
    (await service.findAvailableSlots(SLUG, day(monday()))).map(
      (slot) => slot.time,
    );

  beforeEach(() => {
    store = createStore();
    const prisma = store as unknown as PrismaService;
    users = {
      requireBySlug: jest.fn().mockResolvedValue({ id: USER_ID, slug: SLUG }),
      getProfile: jest.fn(),
      getSettings: jest.fn().mockResolvedValue(DEFAULT_USER_SETTINGS),
      getWhatsappConnection: jest.fn(),
      setWhatsappConnection: jest.fn(),
    };
    service = new PublicAvailabilityService(
      users,
      new ConflictDetectorService(
        new SessionOccurrencesService(prisma),
        new AvailabilityBlocksService(prisma),
      ),
    );
  });

  it("should return available 60-min slots Mon-Sat 07:00-19:00", async () => {
    const result = await service.findAvailableSlots(SLUG, day(monday()));

    // 13 slots: 07:00 to 19:00
    expect(result).toHaveLength(13);
    expect(result[0].time).toBe("07:00");
    expect(result[result.length - 1].time).toBe("19:00");
    expect(result.every((slot) => slot.available)).toBe(true);
    expect(result.every((slot) => slot.type === "In-Person")).toBe(true);
  });

  it("should look the trainer up by slug and read that trainer's work hours", async () => {
    await service.findAvailableSlots(SLUG, day(monday()));

    expect(users.requireBySlug).toHaveBeenCalledWith(SLUG);
    expect(users.getSettings).toHaveBeenCalledWith(USER_ID);
  });

  it("should answer 404 for an unknown slug without reading any event", async () => {
    users.requireBySlug.mockRejectedValue(new NotFoundException());

    await expect(
      service.findAvailableSlots("nobody", day(monday())),
    ).rejects.toThrow(NotFoundException);
    expect(store.event.findMany).not.toHaveBeenCalled();
  });

  it("should expose slots only: no client or session detail", async () => {
    seedSession(store, { date: mondayAt(10) });

    const result = await service.findAvailableSlots(SLUG, day(monday()));

    for (const slot of result) {
      expect(Object.keys(slot).sort()).toEqual([
        "available",
        "date",
        "time",
        "type",
      ]);
    }
  });

  it("should exclude occupied slots", async () => {
    seedSession(store, { date: mondayAt(10) });

    const result = await times();

    expect(result).not.toContain("10:00");
    expect(result).toHaveLength(12);
  });

  it("should exclude every slot a longer session overlaps", async () => {
    seedSession(store, { date: mondayAt(10, 30), durationMinutes: 60 });

    const result = await times();

    expect(result).not.toContain("10:00");
    expect(result).not.toContain("11:00");
    expect(result).toHaveLength(11);
  });

  it("should exclude a session that starts later than the range's end instant on the last day (regression: only sessions before `end` were read)", async () => {
    seedSession(store, { date: mondayAt(15) });

    // The range ends at midnight of Monday, as the website sends it.
    expect(await times()).not.toContain("15:00");
  });

  it("should exclude occurrences of a series", async () => {
    seedSeries(store, { date: mondayAt(9), rrule: "FREQ=WEEKLY;COUNT=4" });

    expect(await times()).not.toContain("09:00");
  });

  it("should free the slot of a cancelled occurrence", async () => {
    const series = seedSeries(store, {
      date: mondayAt(9),
      rrule: "FREQ=WEEKLY;COUNT=4",
    });
    seedException(store, series, mondayAt(9).toISOString(), {
      status: EventStatus.CANCELLED,
    });

    expect(await times()).toContain("09:00");
  });

  it("should follow an occurrence that was moved", async () => {
    const series = seedSeries(store, {
      date: mondayAt(9),
      rrule: "FREQ=WEEKLY;COUNT=4",
    });
    seedException(store, series, mondayAt(9).toISOString(), {
      date: mondayAt(16),
    });

    const result = await times();

    expect(result).toContain("09:00");
    expect(result).not.toContain("16:00");
  });

  it("should not count sessions of soft-deleted clients as busy", async () => {
    seedSession(store, { date: mondayAt(10), clientId: DELETED_CLIENT_ID });

    expect(await times()).toHaveLength(13);
  });

  it("should not count another trainer's sessions as busy", async () => {
    seedSession(store, { date: mondayAt(10), userId: OTHER_USER_ID });

    expect(await times()).toHaveLength(13);
  });

  it("should return slots for multiple days in range", async () => {
    // Mon Jan 6 to Wed Jan 8, 2025 (3 weekdays)
    const result = await service.findAvailableSlots(SLUG, {
      start: new Date(2025, 0, 6),
      end: new Date(2025, 0, 8),
    });

    // 3 weekdays × 13 slots each = 39
    expect(result).toHaveLength(39);
  });

  it("should skip Sundays", async () => {
    const sunday = new Date(2025, 0, 5);

    expect(await service.findAvailableSlots(SLUG, day(sunday))).toEqual([]);
  });

  it("should use custom work hours when configured", async () => {
    useWorkHours({ monday: { enabled: true, start: "09:00", end: "12:00" } });

    // 09:00, 10:00, 11:00, 12:00 = 4 slots
    expect(await times()).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("should enable Sunday when configured", async () => {
    useWorkHours({ sunday: { enabled: true, start: "08:00", end: "10:00" } });
    const sunday = new Date(2025, 0, 5);

    const result = await service.findAvailableSlots(SLUG, day(sunday));

    expect(result).toHaveLength(3); // 08:00, 09:00, 10:00
  });

  it("should exclude availability blocks", async () => {
    seedBlock(store, { date: mondayAt(12), durationMinutes: 60 });

    const result = await times();

    expect(result).not.toContain("12:00");
    expect(result).toHaveLength(12); // 13 - 1 blocked
  });

  it("should respect custom slot duration", async () => {
    useWorkHours({
      monday: { enabled: true, start: "08:00", end: "10:00" },
      slotDurationMinutes: 30,
    });

    // 08:00, 08:30, 09:00, 09:30, 10:00 = 5 slots
    expect(await times()).toEqual([
      "08:00",
      "08:30",
      "09:00",
      "09:30",
      "10:00",
    ]);
  });

  it("should not offer a slot that would end after the day's end", async () => {
    useWorkHours({
      monday: { enabled: true, start: "08:00", end: "09:30" },
      slotDurationMinutes: 60,
    });

    // 09:00–10:00 would pass 09:30, and no slot starts exactly at 09:30.
    expect(await times()).toEqual(["08:00"]);
  });

  it("should propagate a database failure instead of offering every slot (regression: errors were swallowed)", async () => {
    store.event.findMany.mockRejectedValueOnce(new Error("connection lost"));

    await expect(
      service.findAvailableSlots(SLUG, day(monday())),
    ).rejects.toThrow("connection lost");
  });
});
