import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { JwtAuthGuard } from "../../common/auth";
import { AvailabilityBlocksController } from "./availability-blocks.controller";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import {
  MAX_PUBLIC_RANGE_DAYS,
  PublicAvailabilityController,
} from "./public-availability.controller";
import { PublicAvailabilityService } from "./public-availability.service";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

const USER_ID = "trainer-uuid-1";

const guardsOf = (controller: object): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];

const routesOf = (controller: { prototype: object }): string[] =>
  Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== "constructor")
    .map((name) =>
      Reflect.getMetadata(
        PATH_METADATA,
        (controller.prototype as Record<string, object>)[name],
      ),
    );

describe("SessionsController", () => {
  let service: jest.Mocked<SessionsService>;
  let controller: SessionsController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: "s1" }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: "s1" }),
      update: jest.fn().mockResolvedValue({ id: "s1" }),
      toggleComplete: jest.fn().mockResolvedValue({ id: "s1" }),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SessionsService>;
    controller = new SessionsController(service);
  });

  it("should require a JWT on every route", () => {
    expect(guardsOf(SessionsController)).toEqual([JwtAuthGuard]);
  });

  it("should no longer expose the merged or removed routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SessionsController)).toBe(
      "sessions",
    );
    const routes = routesOf(SessionsController);
    for (const removed of [
      "available",
      "recurring-event",
      "recurring-event/:id",
      "exception",
      ":id/scope",
    ]) {
      expect(routes).not.toContain(removed);
    }
  });

  describe("POST / (create)", () => {
    it("should delegate to service.create with userId", async () => {
      const dto = {
        date: "2025-02-01T10:00:00.000Z",
        durationMinutes: 60,
        type: "In-Person",
        category: "Workout",
        clientId: "c1",
      };

      await expect(controller.create(USER_ID, dto)).resolves.toEqual({
        id: "s1",
      });
      expect(service.create).toHaveBeenCalledWith(USER_ID, dto);
    });
  });

  describe("GET / (findAll)", () => {
    it("should pass the parsed range when start and end are provided", async () => {
      await controller.findAll(USER_ID, "2025-03-01", "2025-03-31");

      expect(service.findAll).toHaveBeenCalledWith(USER_ID, {
        start: new Date("2025-03-01"),
        end: new Date("2025-03-31"),
      });
    });

    it("should pass no range when no range params are sent", async () => {
      await controller.findAll(USER_ID);

      expect(service.findAll).toHaveBeenCalledWith(USER_ID, undefined);
    });

    it.each([
      ["only start", "2025-03-01", undefined],
      ["only end", undefined, "2025-03-31"],
      ["an invalid date", "not-a-date", "2025-03-31"],
      ["end before start", "2025-03-31", "2025-03-01"],
    ])("should answer 400 for %s", (_name, start, end) => {
      expect(() => controller.findAll(USER_ID, start, end)).toThrow(
        BadRequestException,
      );
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });

  describe("GET /:id (findOne)", () => {
    it("should delegate to service.findOne with userId and id", async () => {
      await controller.findOne(USER_ID, "s1");

      expect(service.findOne).toHaveBeenCalledWith(USER_ID, "s1");
    });
  });

  describe("PATCH /:id", () => {
    it("should delegate to service.update, occurrence ids included", async () => {
      const id = "series-1_2025-01-13T10:00:00.000Z";

      await controller.update(USER_ID, id, { cancelled: true });

      expect(service.update).toHaveBeenCalledWith(USER_ID, id, {
        cancelled: true,
      });
    });
  });

  describe("POST /:id/toggle-complete", () => {
    it("should delegate to service.toggleComplete", async () => {
      await controller.toggleComplete(USER_ID, "s1");

      expect(service.toggleComplete).toHaveBeenCalledWith(USER_ID, "s1");
    });
  });

  describe("DELETE /:id", () => {
    it("should delegate to service.remove", async () => {
      await expect(controller.remove(USER_ID, "s1")).resolves.toBeUndefined();

      expect(service.remove).toHaveBeenCalledWith(USER_ID, "s1");
    });
  });
});

describe("AvailabilityBlocksController", () => {
  let service: jest.Mocked<AvailabilityBlocksService>;
  let controller: AvailabilityBlocksController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: "b1" }),
      findAllForRange: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: "b1" }),
      remove: jest.fn().mockResolvedValue({ id: "b1" }),
    } as unknown as jest.Mocked<AvailabilityBlocksService>;
    controller = new AvailabilityBlocksController(service);
  });

  it("should require a JWT on every route", () => {
    expect(guardsOf(AvailabilityBlocksController)).toEqual([JwtAuthGuard]);
  });

  it("should delegate create, update and remove with the userId", async () => {
    const dto = {
      title: "Almoço",
      dtstart: "2025-01-15T12:00:00Z",
      dtend: "2025-01-15T13:00:00Z",
    };

    await controller.create(USER_ID, dto);
    await controller.update(USER_ID, "b1", { title: "Reunião" });
    await expect(controller.remove(USER_ID, "b1")).resolves.toEqual({
      id: "b1",
    });

    expect(service.create).toHaveBeenCalledWith(USER_ID, dto);
    expect(service.update).toHaveBeenCalledWith(USER_ID, "b1", {
      title: "Reunião",
    });
    expect(service.remove).toHaveBeenCalledWith(USER_ID, "b1");
  });

  it("should list the blocks of the parsed range", async () => {
    await controller.findAll(USER_ID, "2025-03-01", "2025-03-31");

    expect(service.findAllForRange).toHaveBeenCalledWith(
      USER_ID,
      new Date("2025-03-01"),
      new Date("2025-03-31"),
    );
  });

  it.each([
    ["no range", undefined, undefined],
    ["only start", "2025-03-01", undefined],
    ["an invalid date", "2025-03-01", "nope"],
  ])("should answer 400 for %s", (_name, start, end) => {
    expect(() => controller.findAll(USER_ID, start, end)).toThrow(
      BadRequestException,
    );
    expect(service.findAllForRange).not.toHaveBeenCalled();
  });
});

describe("PublicAvailabilityController", () => {
  let service: jest.Mocked<PublicAvailabilityService>;
  let controller: PublicAvailabilityController;

  beforeEach(() => {
    service = {
      findAvailableSlots: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PublicAvailabilityService>;
    controller = new PublicAvailabilityController(service);
  });

  it("should be public and addressed by slug", () => {
    expect(guardsOf(PublicAvailabilityController)).toEqual([]);
    expect(
      Reflect.getMetadata(PATH_METADATA, PublicAvailabilityController),
    ).toBe("public/:slug");
    expect(routesOf(PublicAvailabilityController)).toEqual(["availability"]);
  });

  it("should pass the slug and the parsed range to the service", async () => {
    await controller.getAvailableSlots("ana-silva", "2025-03-01", "2025-03-31");

    expect(service.findAvailableSlots).toHaveBeenCalledWith("ana-silva", {
      start: new Date("2025-03-01"),
      end: new Date("2025-03-31"),
    });
  });

  it("should default the range to 30 days from today", async () => {
    await controller.getAvailableSlots("ana-silva");

    const [, range] = service.findAvailableSlots.mock.calls[0];
    const days = (range.end.getTime() - range.start.getTime()) / 86_400_000;
    expect(days).toBe(30);
    expect(range.start.toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );
  });

  it("should answer 400 for a range longer than 92 days", () => {
    expect(MAX_PUBLIC_RANGE_DAYS).toBe(92);
    expect(() =>
      controller.getAvailableSlots("ana-silva", "2025-01-01", "2025-04-04"),
    ).toThrow(BadRequestException);
    expect(service.findAvailableSlots).not.toHaveBeenCalled();
  });

  it("should accept a range of exactly 92 days", async () => {
    await controller.getAvailableSlots("ana-silva", "2025-01-01", "2025-04-03");

    expect(service.findAvailableSlots).toHaveBeenCalled();
  });
});
