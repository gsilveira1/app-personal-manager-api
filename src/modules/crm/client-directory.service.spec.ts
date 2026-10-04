import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { CLIENT_DIRECTORY, ClientDirectory } from "../../common/ports";
import { PrismaService } from "../prisma/prisma.service";
import { ClientDirectoryModule } from "./client-directory.module";
import { ClientDirectoryService } from "./client-directory.service";

describe("ClientDirectoryService", () => {
  let directory: ClientDirectory;
  let prisma: {
    client: { findFirst: jest.Mock; findMany: jest.Mock; groupBy: jest.Mock };
  };

  const userId = "trainer-1";
  const summary = {
    id: "client-1",
    userId,
    name: "Maria",
    email: "maria@example.com",
    phone: "53999001122",
    avatar: null,
    status: "ACTIVE",
    dateOfBirth: null,
    notificationEnabled: true,
  };

  beforeEach(async () => {
    prisma = {
      client: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientDirectoryService,
        { provide: CLIENT_DIRECTORY, useExisting: ClientDirectoryService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    directory = moduleRef.get<ClientDirectory>(CLIENT_DIRECTORY);
  });

  it("module provides and exports the CLIENT_DIRECTORY token and imports nothing", () => {
    expect(Reflect.getMetadata("exports", ClientDirectoryModule)).toEqual([
      CLIENT_DIRECTORY,
    ]);
    expect(
      Reflect.getMetadata("imports", ClientDirectoryModule),
    ).toBeUndefined();
    expect(Reflect.getMetadata("providers", ClientDirectoryModule)).toEqual(
      expect.arrayContaining([
        { provide: CLIENT_DIRECTORY, useExisting: ClientDirectoryService },
      ]),
    );
  });

  describe("requireOwned", () => {
    it("returns the summary of a live client of the trainer", async () => {
      prisma.client.findFirst.mockResolvedValue(summary);

      await expect(directory.requireOwned(userId, "client-1")).resolves.toEqual(
        summary,
      );
      expect(prisma.client.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "client-1", deletedAt: null },
        }),
      );
    });

    it("never selects more than the summary fields", async () => {
      prisma.client.findFirst.mockResolvedValue(summary);

      await directory.requireOwned(userId, "client-1");

      const { select } = prisma.client.findFirst.mock.calls[0][0];
      expect(Object.keys(select).sort()).toEqual(Object.keys(summary).sort());
    });

    it("answers 404 when the client is missing or soft-deleted", async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await expect(directory.requireOwned(userId, "gone")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("answers 403 when the client belongs to another trainer", async () => {
      prisma.client.findFirst.mockResolvedValue({ ...summary, userId: "x" });

      await expect(directory.requireOwned(userId, "client-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("findById", () => {
    it("filters soft-deleted clients and returns null for them", async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await expect(directory.findById("client-1")).resolves.toBeNull();
      expect(prisma.client.findFirst.mock.calls[0][0].where).toEqual({
        id: "client-1",
        deletedAt: null,
      });
    });
  });

  describe("findManyOwned", () => {
    it("returns a map of the trainer's live clients in one query", async () => {
      prisma.client.findMany.mockResolvedValue([summary]);

      const result = await directory.findManyOwned(userId, [
        "client-1",
        "client-1",
        "client-2",
      ]);

      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ["client-1", "client-2"] },
        userId,
        deletedAt: null,
      });
      expect(result.get("client-1")).toEqual(summary);
      expect(result.has("client-2")).toBe(false);
    });

    it("does not query for an empty id list", async () => {
      const result = await directory.findManyOwned(userId, []);

      expect(result.size).toBe(0);
      expect(prisma.client.findMany).not.toHaveBeenCalled();
    });
  });

  describe("countByOwners", () => {
    it("counts live clients per trainer in one query", async () => {
      prisma.client.groupBy.mockResolvedValue([
        { userId: "trainer-1", _count: { _all: 3 } },
      ]);

      const result = await directory.countByOwners(["trainer-1", "trainer-2"]);

      expect(prisma.client.groupBy).toHaveBeenCalledWith({
        by: ["userId"],
        where: { userId: { in: ["trainer-1", "trainer-2"] }, deletedAt: null },
        _count: { _all: true },
      });
      expect(result.get("trainer-1")).toBe(3);
      expect(result.has("trainer-2")).toBe(false);
    });

    it("does not query for an empty owner list", async () => {
      const result = await directory.countByOwners([]);

      expect(result.size).toBe(0);
      expect(prisma.client.groupBy).not.toHaveBeenCalled();
    });
  });
});
