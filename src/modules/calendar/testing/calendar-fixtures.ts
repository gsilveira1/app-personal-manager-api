import { EventType } from "@prisma/client";
import { FakeClient, FakeEvent, FakeEventStore } from "./fake-event-store";

export const USER_ID = "trainer-uuid-1";
export const OTHER_USER_ID = "other-user";
export const CLIENT_ID = "client-uuid-1";
export const DELETED_CLIENT_ID = "client-deleted";

export const CLIENTS: Record<string, FakeClient> = {
  [CLIENT_ID]: { name: "Maria Santos", avatar: null, deletedAt: null },
  [DELETED_CLIENT_ID]: {
    name: "Ex Aluno",
    avatar: null,
    deletedAt: new Date("2025-01-01T00:00:00Z"),
  },
};

export const createStore = () => new FakeEventStore(CLIENTS);

type Overrides = Partial<FakeEvent>;

const SESSION_DEFAULTS = {
  userId: USER_ID,
  clientId: CLIENT_ID,
  type: EventType.SESSION,
  sessionType: "In-Person",
  category: "Workout",
  durationMinutes: 60,
};

/** One-off session on 2025-02-01 10:00 UTC unless overridden. */
export const seedSession = (store: FakeEventStore, overrides: Overrides = {}) =>
  store.seed({
    ...SESSION_DEFAULTS,
    date: new Date("2025-02-01T10:00:00Z"),
    ...overrides,
  });

/** Weekly series: Mondays 10:00 UTC from 2025-01-06, four occurrences, unless overridden. */
export const seedSeries = (store: FakeEventStore, overrides: Overrides = {}) =>
  store.seed({
    ...SESSION_DEFAULTS,
    date: new Date("2025-01-06T10:00:00Z"),
    rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
    ...overrides,
  });

/** Exception of `series` for the occurrence at `originalStartTime`. */
export const seedException = (
  store: FakeEventStore,
  series: FakeEvent,
  originalStartTime: string,
  overrides: Overrides = {},
) =>
  store.seed({
    ...SESSION_DEFAULTS,
    userId: series.userId,
    clientId: series.clientId,
    durationMinutes: series.durationMinutes,
    parentEventId: series.id,
    originalStartTime: new Date(originalStartTime),
    date: new Date(originalStartTime),
    ...overrides,
  });

/** One-off block 2025-01-15 12:00–13:00 UTC unless overridden. */
export const seedBlock = (store: FakeEventStore, overrides: Overrides = {}) =>
  store.seed({
    userId: USER_ID,
    type: EventType.BLOCK,
    title: "Almoço",
    date: new Date("2025-01-15T12:00:00Z"),
    durationMinutes: 60,
    ...overrides,
  });
