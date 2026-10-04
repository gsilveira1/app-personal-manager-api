import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { EventType } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import {
  createStore,
  OTHER_USER_ID,
  seedBlock,
  seedSession,
  USER_ID,
} from "./testing/calendar-fixtures";
import { FakeEventStore } from "./testing/fake-event-store";

describe("AvailabilityBlocksService", () => {
  let store: FakeEventStore;
  let service: AvailabilityBlocksService;

  beforeEach(() => {
    store = createStore();
    service = new AvailabilityBlocksService(store as unknown as PrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("create", () => {
    it("should create a one-off availability block as a BLOCK event", async () => {
      const result = await service.create(USER_ID, {
        title: "Almoço",
        dtstart: "2025-01-15T12:00:00Z",
        dtend: "2025-01-15T13:00:00Z",
      });

      expect(store.event.create).toHaveBeenCalledWith({
        data: {
          type: EventType.BLOCK,
          title: "Almoço",
          userId: USER_ID,
          rrule: null,
          timezone: "America/Sao_Paulo",
          date: new Date("2025-01-15T12:00:00Z"),
          durationMinutes: 60,
          notes: null,
        },
      });
      expect(result).toMatchObject({
        title: "Almoço",
        rrule: null,
        userId: USER_ID,
        notes: null,
      });
    });

    it("should round-trip dtstart and dtend through date + durationMinutes", async () => {
      const result = await service.create(USER_ID, {
        title: "Almoço",
        dtstart: "2025-01-15T12:00:00.000Z",
        dtend: "2025-01-15T13:30:00.000Z",
      });

      expect(result.dtstart).toBe("2025-01-15T12:00:00.000Z");
      expect(result.dtend).toBe("2025-01-15T13:30:00.000Z");
      expect(store.rows[0].durationMinutes).toBe(90);
    });

    it("should round a partial minute up", async () => {
      const result = await service.create(USER_ID, {
        title: "Pausa",
        dtstart: "2025-01-15T12:00:00.000Z",
        dtend: "2025-01-15T12:00:30.000Z",
      });

      expect(store.rows[0].durationMinutes).toBe(1);
      expect(result.dtend).toBe("2025-01-15T12:01:00.000Z");
    });

    it.each([
      ["equal to dtstart", "2025-01-15T12:00:00Z"],
      ["before dtstart", "2025-01-15T11:00:00Z"],
    ])("should answer 400 when dtend is %s", async (_label, dtend) => {
      await expect(
        service.create(USER_ID, {
          title: "Almoço",
          dtstart: "2025-01-15T12:00:00Z",
          dtend,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(store.event.create).not.toHaveBeenCalled();
    });

    it("should create a recurring availability block", async () => {
      const result = await service.create(USER_ID, {
        title: "Almoço",
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        dtstart: "2025-01-06T12:00:00Z",
        dtend: "2025-01-06T13:00:00Z",
      });

      expect(result.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    });

    it("should answer 400 for a rule that does not parse", async () => {
      await expect(
        service.create(USER_ID, {
          title: "Almoço",
          rrule: "FREQ=WEEKLY;BYDAY=XX",
          dtstart: "2025-01-06T12:00:00Z",
          dtend: "2025-01-06T13:00:00Z",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(store.event.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update a block owned by the user", async () => {
      const block = seedBlock(store);

      const result = await service.update(USER_ID, block.id, {
        title: "Pausa",
      });

      expect(result.title).toBe("Pausa");
      expect(store.event.update).toHaveBeenCalledWith({
        where: { id: block.id, userId: USER_ID },
        data: { title: "Pausa" },
      });
    });

    it("should keep dtend when only dtstart moves", async () => {
      const block = seedBlock(store);

      const result = await service.update(USER_ID, block.id, {
        dtstart: "2025-01-15T12:30:00.000Z",
      });

      expect(result.dtstart).toBe("2025-01-15T12:30:00.000Z");
      expect(result.dtend).toBe("2025-01-15T13:00:00.000Z");
    });

    it("should keep dtstart when only dtend moves", async () => {
      const block = seedBlock(store);

      const result = await service.update(USER_ID, block.id, {
        dtend: "2025-01-15T14:00:00.000Z",
      });

      expect(result.dtstart).toBe("2025-01-15T12:00:00.000Z");
      expect(result.dtend).toBe("2025-01-15T14:00:00.000Z");
    });

    it("should answer 400 when the new bounds are inverted", async () => {
      const block = seedBlock(store);

      await expect(
        service.update(USER_ID, block.id, { dtend: "2025-01-15T11:00:00Z" }),
      ).rejects.toThrow(BadRequestException);
      expect(store.event.update).not.toHaveBeenCalled();
    });

    it("should clear the rule with null and reject an invalid one", async () => {
      const block = seedBlock(store, { rrule: "FREQ=DAILY" });

      await expect(
        service.update(USER_ID, block.id, { rrule: "FREQ=BOGUS" }),
      ).rejects.toThrow(BadRequestException);

      const result = await service.update(USER_ID, block.id, { rrule: null });
      expect(result.rrule).toBeNull();
    });

    it("should throw NotFoundException when block does not exist", async () => {
      await expect(
        service.update(USER_ID, "non-existent", { title: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when the id is a session, not a block", async () => {
      const session = seedSession(store);

      await expect(
        service.update(USER_ID, session.id, { title: "x" }),
      ).rejects.toThrow(NotFoundException);
      expect(store.event.update).not.toHaveBeenCalled();
    });

    it("should throw ForbiddenException when block belongs to another user", async () => {
      const block = seedBlock(store, { userId: OTHER_USER_ID });

      await expect(
        service.update(USER_ID, block.id, { title: "x" }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("remove", () => {
    it("should delete a block owned by the user and return it", async () => {
      const block = seedBlock(store);

      const result = await service.remove(USER_ID, block.id);

      expect(store.event.delete).toHaveBeenCalledWith({
        where: { id: block.id, userId: USER_ID },
      });
      expect(result).toMatchObject({ id: block.id, title: "Almoço" });
      expect(store.rows).toHaveLength(0);
    });

    it("should throw NotFoundException when block does not exist", async () => {
      await expect(service.remove(USER_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should refuse to delete a session through the block route", async () => {
      const session = seedSession(store);

      await expect(service.remove(USER_ID, session.id)).rejects.toThrow(
        NotFoundException,
      );
      expect(store.rows).toHaveLength(1);
    });

    it("should throw ForbiddenException when block belongs to another user", async () => {
      const block = seedBlock(store, { userId: OTHER_USER_ID });

      await expect(service.remove(USER_ID, block.id)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("materializeBlocksForRange", () => {
    it("should return one-off blocks that overlap the range", async () => {
      const block = seedBlock(store);

      const result = await service.materializeBlocksForRange(
        USER_ID,
        new Date("2025-01-01T00:00:00Z"),
        new Date("2025-01-31T23:59:59Z"),
      );

      expect(result).toEqual([
        {
          id: block.id,
          blockId: block.id,
          title: "Almoço",
          start: "2025-01-15T12:00:00.000Z",
          end: "2025-01-15T13:00:00.000Z",
          isRecurring: false,
          notes: null,
        },
      ]);
    });

    it("should leave out one-off blocks that ended before the range", async () => {
      seedBlock(store);

      const result = await service.materializeBlocksForRange(
        USER_ID,
        new Date("2025-01-16T00:00:00Z"),
        new Date("2025-01-31T23:59:59Z"),
      );

      expect(result).toEqual([]);
    });

    it("should expand recurring blocks via RRULE", async () => {
      const block = seedBlock(store, {
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        date: new Date("2025-01-06T12:00:00Z"), // Monday
      });

      const result = await service.materializeBlocksForRange(
        USER_ID,
        new Date("2025-01-06T00:00:00Z"),
        new Date("2025-01-10T23:59:59Z"), // Mon-Fri
      );

      expect(result).toHaveLength(5);
      expect(result.every((b) => b.isRecurring)).toBe(true);
      expect(result.every((b) => b.title === "Almoço")).toBe(true);
      expect(result[1]).toMatchObject({
        id: `${block.id}_2025-01-07T12:00:00.000Z`,
        blockId: block.id,
        start: "2025-01-07T12:00:00.000Z",
        end: "2025-01-07T13:00:00.000Z",
      });
    });

    it("should return empty array when no blocks exist", async () => {
      const result = await service.findAllForRange(
        USER_ID,
        new Date("2025-01-01"),
        new Date("2025-01-31"),
      );

      expect(result).toEqual([]);
    });

    it("should only read the caller's BLOCK events", async () => {
      seedBlock(store, { userId: OTHER_USER_ID });
      seedSession(store, { date: new Date("2025-01-15T12:00:00Z") });

      const result = await service.materializeBlocksForRange(
        USER_ID,
        new Date("2025-01-01"),
        new Date("2025-01-31"),
      );

      expect(result).toEqual([]);
    });

    it("should leave a malformed stored rule out and log it (never a silent skip)", async () => {
      const errorLog = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation();
      const bad = seedBlock(store, {
        rrule: "TOTALLY_INVALID",
        date: new Date("2025-01-06T12:00:00Z"),
      });

      const result = await service.materializeBlocksForRange(
        USER_ID,
        new Date("2025-01-01"),
        new Date("2025-01-31"),
      );

      expect(result).toEqual([]);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain(bad.id);
      expect(errorLog.mock.calls[0][0]).toContain("TOTALLY_INVALID");
    });
  });

  describe("owner in the write (regression L1: the write used to filter by id only)", () => {
    it("should update with the owner in the where", async () => {
      const block = seedBlock(store);

      await service.update(USER_ID, block.id, { title: "Novo" });

      expect(store.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: block.id, userId: USER_ID } }),
      );
    });

    it("should delete with the owner in the where", async () => {
      const block = seedBlock(store);

      await service.remove(USER_ID, block.id);

      expect(store.event.delete).toHaveBeenCalledWith({
        where: { id: block.id, userId: USER_ID },
      });
    });

    it.each([
      ["update", (id: string) => service.update(USER_ID, id, { title: "x" })],
      ["remove", (id: string) => service.remove(USER_ID, id)],
    ])(
      "should answer 404 and write nothing when the block changes owner between the check and the %s",
      async (_label, write) => {
        const block = seedBlock(store);
        store.event.findUnique.mockResolvedValueOnce({ ...block });
        block.userId = OTHER_USER_ID;

        await expect(write(block.id)).rejects.toThrow(NotFoundException);
        expect(store.rows).toEqual([
          expect.objectContaining({ id: block.id, title: "Almoço" }),
        ]);
      },
    );
  });

  describe("bounded expansion (regression H1)", () => {
    let errorLog: jest.SpyInstance;

    beforeEach(() => {
      errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();
    });

    it("should refuse a rule with a key outside the whitelist on create and update", async () => {
      const rrule = "FREQ=DAILY;BYHOUR=0,1;BYMINUTE=0,1;BYSECOND=0,1";
      const block = seedBlock(store);

      await expect(
        service.create(USER_ID, {
          title: "Abuso",
          rrule,
          dtstart: "2025-01-15T12:00:00Z",
          dtend: "2025-01-15T13:00:00Z",
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update(USER_ID, block.id, { rrule }),
      ).rejects.toThrow(BadRequestException);
      expect(store.rows).toEqual([expect.objectContaining({ rrule: null })]);
    });

    it("should leave a stored rule outside the whitelist out and log it, without expanding it", async () => {
      const abusive = seedBlock(store, {
        rrule: "FREQ=DAILY;BYHOUR=0,1,2;BYMINUTE=0,1,2;BYSECOND=0,1,2",
        date: new Date("2025-01-06T12:00:00Z"),
      });
      const fine = seedBlock(store, {
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=2",
        date: new Date("2025-01-06T12:00:00Z"),
      });

      const result = await service.materializeBlocksForRange(
        USER_ID,
        new Date("2025-01-01"),
        new Date("2025-01-31"),
      );

      expect(result.map((item) => item.blockId)).toEqual([fine.id, fine.id]);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain(abusive.id);
      expect(errorLog.mock.calls[0][0]).toContain("BYHOUR");
    });

    it("should fail with 422 and log the block id when a rule exceeds the occurrence cap (never truncate)", async () => {
      const daily = seedBlock(store, {
        rrule: "FREQ=DAILY",
        date: new Date("2025-01-06T12:00:00Z"),
      });

      await expect(
        service.materializeBlocksForRange(
          USER_ID,
          new Date("2025-01-01"),
          new Date("2035-01-01"),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain(daily.id);
    });
  });
});
