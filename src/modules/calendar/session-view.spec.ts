import { InternalServerErrorException } from "@nestjs/common";
import { EventStatus } from "@prisma/client";

import { SeriesRow, SessionRow } from "./calendar.types";
import {
  nextStatus,
  toggledStatus,
  toStoredView,
  toVirtualView,
} from "./session-view";

const client = { name: "Maria Santos", avatar: null };

const row = (overrides: Partial<SessionRow> = {}): SessionRow =>
  ({
    id: "session-1",
    type: "SESSION",
    title: null,
    date: new Date("2025-02-01T10:00:00Z"),
    durationMinutes: 60,
    status: EventStatus.SCHEDULED,
    rrule: null,
    timezone: "America/Sao_Paulo",
    notes: "Treino A",
    sessionType: "In-Person",
    category: "Workout",
    parentEventId: null,
    originalStartTime: null,
    workoutSheetId: null,
    workoutSegmentId: null,
    clientId: "client-1",
    userId: "trainer-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    client,
    parent: null,
    ...overrides,
  }) as SessionRow;

describe("toStoredView", () => {
  it("maps a one-off session", () => {
    expect(toStoredView(row())).toEqual({
      id: "session-1",
      date: "2025-02-01T10:00:00.000Z",
      durationMinutes: 60,
      type: "In-Person",
      category: "Workout",
      notes: "Treino A",
      status: "SCHEDULED",
      completed: false,
      cancelled: false,
      clientId: "client-1",
      userId: "trainer-1",
      client,
      workoutSheetId: null,
      workoutSegmentId: null,
      workout: null,
      timezone: "America/Sao_Paulo",
      isVirtual: false,
      recurringEventId: null,
      recurrenceId: null,
      originalStartTime: null,
      exceptionId: null,
      rrule: null,
    });
  });

  it("derives completed from the status", () => {
    const view = toStoredView(row({ status: EventStatus.COMPLETED }));
    expect(view).toMatchObject({ completed: true, cancelled: false });
  });

  it("presents an exception as the occurrence it replaces", () => {
    const view = toStoredView(
      row({
        id: "exc-1",
        parentEventId: "series-1",
        originalStartTime: new Date("2025-01-06T10:00:00Z"),
        date: new Date("2025-01-07T14:00:00Z"),
        status: EventStatus.COMPLETED,
        notes: "Remarcado para terça",
        parent: { notes: "Nota da série", rrule: "FREQ=WEEKLY;BYDAY=MO" },
      }),
    );

    expect(view).toMatchObject({
      id: "series-1_2025-01-06T10:00:00.000Z",
      date: "2025-01-07T14:00:00.000Z",
      originalStartTime: "2025-01-06T10:00:00.000Z",
      isVirtual: true,
      recurringEventId: "series-1",
      recurrenceId: "series-1",
      exceptionId: "exc-1",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      notes: "Remarcado para terça",
      completed: true,
    });
  });

  it("falls back to the master's notes when the exception has none", () => {
    const view = toStoredView(
      row({
        parentEventId: "series-1",
        originalStartTime: new Date("2025-01-06T10:00:00Z"),
        notes: null,
        parent: { notes: "Nota da série", rrule: "FREQ=DAILY" },
      }),
    );
    expect(view.notes).toBe("Nota da série");
  });

  it("flags a cancelled exception", () => {
    const view = toStoredView(
      row({
        parentEventId: "series-1",
        originalStartTime: new Date("2025-01-06T10:00:00Z"),
        status: EventStatus.CANCELLED,
        parent: { notes: null, rrule: "FREQ=DAILY" },
      }),
    );
    expect(view).toMatchObject({ cancelled: true, completed: false });
  });

  it.each([
    ["has no client", { clientId: null, client: null }],
    ["has no session type", { sessionType: null }],
    ["has no category", { category: null }],
    ["is an exception whose parent is missing", { parentEventId: "series-1" }],
  ])("fails loudly when the row %s", (_label, overrides) => {
    expect(() => toStoredView(row(overrides as Partial<SessionRow>))).toThrow(
      InternalServerErrorException,
    );
  });
});

describe("toVirtualView", () => {
  it("maps an occurrence without exception", () => {
    const series = row({
      id: "series-1",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      workoutSheetId: "sheet-1",
      workoutSegmentId: "item-a",
    }) as unknown as SeriesRow;

    expect(
      toVirtualView(series, new Date("2025-01-13T10:00:00Z")),
    ).toMatchObject({
      id: "series-1_2025-01-13T10:00:00.000Z",
      date: "2025-01-13T10:00:00.000Z",
      originalStartTime: "2025-01-13T10:00:00.000Z",
      status: "SCHEDULED",
      completed: false,
      cancelled: false,
      isVirtual: true,
      recurringEventId: "series-1",
      recurrenceId: "series-1",
      exceptionId: null,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      notes: "Treino A",
      workoutSheetId: "sheet-1",
      workoutSegmentId: "item-a",
      workout: null,
    });
  });
});

describe("nextStatus", () => {
  const { SCHEDULED, COMPLETED, CANCELLED } = EventStatus;

  it.each([
    [SCHEDULED, {}, SCHEDULED],
    [COMPLETED, {}, COMPLETED],
    [SCHEDULED, { completed: true }, COMPLETED],
    [COMPLETED, { completed: false }, SCHEDULED],
    [SCHEDULED, { cancelled: true }, CANCELLED],
    [COMPLETED, { cancelled: true }, CANCELLED],
    [CANCELLED, { cancelled: false }, SCHEDULED],
    [CANCELLED, { completed: false }, CANCELLED],
    [CANCELLED, { completed: true }, COMPLETED],
    [COMPLETED, { cancelled: false }, COMPLETED],
    [SCHEDULED, { completed: true, cancelled: true }, CANCELLED],
  ])("%s + %j → %s", (current, flags, expected) => {
    expect(nextStatus(current, flags)).toBe(expected);
  });
});

describe("toggledStatus", () => {
  it("flips SCHEDULED and COMPLETED", () => {
    expect(toggledStatus(EventStatus.SCHEDULED)).toBe(EventStatus.COMPLETED);
    expect(toggledStatus(EventStatus.COMPLETED)).toBe(EventStatus.SCHEDULED);
  });
});
