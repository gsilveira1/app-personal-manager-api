import { Event, EventStatus, EventType, Prisma } from "@prisma/client";

/**
 * In-memory stand-in for `prisma.event`, for unit tests only. It evaluates the subset
 * of Prisma filters the calendar module uses, so that range, soft-delete and exception
 * rules are exercised for real instead of being asserted on a canned mock.
 */
export interface FakeClient {
  name: string;
  avatar: string | null;
  deletedAt: Date | null;
}

export type FakeEvent = Event;
type Where = Record<string, any>;
type Row = Record<string, any>;

const COMPARATORS = ["gte", "lte", "gt", "lt", "not"];

const toComparable = (value: unknown) =>
  value instanceof Date ? value.getTime() : value;

function matchesCondition(actual: unknown, condition: unknown): boolean {
  const isOperatorObject =
    condition !== null &&
    typeof condition === "object" &&
    !(condition instanceof Date) &&
    Object.keys(condition).every((key) => COMPARATORS.includes(key));
  if (!isOperatorObject)
    return toComparable(actual) === toComparable(condition);

  const value = toComparable(actual) as number;
  return Object.entries(condition as Where).every(([operator, operand]) => {
    const bound = toComparable(operand) as number;
    if (operator === "not") return value !== bound;
    if (actual === null || actual === undefined) return false;
    if (operator === "gte") return value >= bound;
    if (operator === "lte") return value <= bound;
    if (operator === "gt") return value > bound;
    return value < bound;
  });
}

export class FakeEventStore {
  rows: FakeEvent[] = [];
  private sequence = 0;

  constructor(private readonly clients: Record<string, FakeClient>) {}

  /** Inserts a row directly, bypassing the service (test arrangement). */
  seed(data: Partial<FakeEvent> & { userId: string }): FakeEvent {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const row: FakeEvent = {
      id: `event-${++this.sequence}`,
      type: EventType.SESSION,
      title: null,
      date: now,
      durationMinutes: 60,
      status: EventStatus.SCHEDULED,
      rrule: null,
      timezone: "America/Sao_Paulo",
      notes: null,
      sessionType: null,
      category: null,
      parentEventId: null,
      originalStartTime: null,
      workoutSheetId: null,
      workoutSegmentId: null,
      clientId: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.rows.push(row);
    return row;
  }

  readonly event = {
    findMany: jest.fn(async (args: Where = {}) => this.select(args)),
    findFirst: jest.fn(
      async (args: Where = {}) => this.select(args)[0] ?? null,
    ),
    findUnique: jest.fn(async (args: Where) => this.select(args)[0] ?? null),
    create: jest.fn(async (args: Where) =>
      this.project(this.seed(args.data), args.include),
    ),
    update: jest.fn(async (args: Where) =>
      this.project(
        this.patch(this.requireWhere(args.where).id, args.data),
        args.include,
      ),
    ),
    upsert: jest.fn(async (args: Where) => {
      const key = args.where.parentEventId_originalStartTime;
      const existing = this.rows.find((row) => this.matches(row, key));
      const row = existing
        ? this.patch(existing.id, args.update)
        : this.seed(args.create);
      return this.project(row, args.include);
    }),
    delete: jest.fn(async (args: Where) => {
      const row = this.requireWhere(args.where);
      this.rows = this.rows.filter(
        (other) => other.id !== row.id && other.parentEventId !== row.id,
      );
      return row;
    }),
  };

  /** Stand-in for the interactive-transaction client: the same rows, separate spies. */
  readonly tx = {
    event: {
      findMany: jest.fn((args?: Where) => this.event.findMany(args)),
      findFirst: jest.fn((args?: Where) => this.event.findFirst(args)),
      create: jest.fn((args: Where) => this.event.create(args)),
    },
  };

  /** Every raw statement run inside a transaction: `(strings, ...values)`. */
  readonly $executeRaw = jest.fn();

  private readonly locks = new Map<string, Promise<void>>();

  /**
   * Runs `run` with a transaction client. A raw statement takes a lock named after its
   * values and holds it until the transaction ends, like `pg_advisory_xact_lock`.
   * Rollback is not emulated.
   */
  readonly $transaction = jest.fn(
    async (run: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const $executeRaw = async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        this.$executeRaw(strings, ...values);
        const key = values.join("|");
        const previous = this.locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        this.locks.set(
          key,
          previous.then(() => held),
        );
        await previous;
        releases.push(release);
        return 1;
      };
      try {
        return await run({ event: this.tx.event, $executeRaw });
      } finally {
        releases.forEach((release) => release());
      }
    },
  );

  /** Like Prisma: a write whose `where` matches no row fails with P2025. */
  private requireWhere(where: Where): FakeEvent {
    const row = this.rows.find((candidate) => this.matches(candidate, where));
    if (!row) {
      throw new Prisma.PrismaClientKnownRequestError(
        "No record was found for the write.",
        { code: "P2025", clientVersion: "fake" },
      );
    }
    return row;
  }

  private require(id: string): FakeEvent {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`FakeEventStore: no event ${id}`);
    return row;
  }

  private patch(id: string, data: Partial<FakeEvent>): FakeEvent {
    return Object.assign(this.require(id), data);
  }

  private select(args: Where): Row[] {
    const rows = this.rows
      .filter((row) => this.matches(row, args.where ?? {}))
      .map((row) => this.project(row, args.include));
    if (args.orderBy?.date === "asc") {
      rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    }
    return rows;
  }

  private matches(row: FakeEvent, where: Where): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") {
        return (condition as Where[]).some((option) =>
          this.matches(row, option),
        );
      }
      if (key === "NOT") return !this.matches(row, condition as Where);
      if (key === "client") {
        const client = row.clientId ? this.clients[row.clientId] : undefined;
        return (
          !!client &&
          Object.entries(condition as Where).every(([field, expected]) =>
            matchesCondition((client as Row)[field], expected),
          )
        );
      }
      return matchesCondition((row as Row)[key], condition);
    });
  }

  private project(row: FakeEvent, include?: Where): Row {
    const projected: Row = { ...row };
    if (include?.client) {
      const client = row.clientId ? this.clients[row.clientId] : undefined;
      projected.client = client
        ? { name: client.name, avatar: client.avatar }
        : null;
    }
    if (include?.parent) {
      const parent = this.rows.find((other) => other.id === row.parentEventId);
      projected.parent = parent
        ? { notes: parent.notes, rrule: parent.rrule }
        : null;
    }
    if (include?.exceptions) {
      projected.exceptions = this.rows
        .filter((other) => other.parentEventId === row.id)
        .filter((other) => this.matches(other, include.exceptions.where ?? {}))
        .map((other) => ({ originalStartTime: other.originalStartTime }));
    }
    return projected;
  }
}
