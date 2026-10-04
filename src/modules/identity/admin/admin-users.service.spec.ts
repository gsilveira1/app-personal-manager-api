import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { CLIENT_DIRECTORY } from "../../../common/ports";
import {
  DEFAULT_ACCOUNT_LIMITS,
  DEFAULT_USER_SETTINGS,
} from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";
import { buildUser, prismaError } from "../testing";
import {
  SettingsPatchBuilder,
  UserSettingsStore,
} from "../user-settings.store";
import { AdminUsersService } from "./admin-users.service";

describe("AdminUsersService", () => {
  let service: AdminUsersService;
  let tx: { user: { update: jest.Mock } };
  let prisma: any;
  let store: { patchWithin: jest.Mock };
  let clients: { countByOwners: jest.Mock };

  beforeEach(async () => {
    tx = { user: { update: jest.fn() } };
    prisma = {
      user: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((run) => run(tx)),
    };
    store = { patchWithin: jest.fn() };
    clients = { countByOwners: jest.fn().mockResolvedValue(new Map()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserSettingsStore, useValue: store },
        { provide: CLIENT_DIRECTORY, useValue: clients },
      ],
    }).compile();
    service = module.get(AdminUsersService);
  });

  describe("findAll", () => {
    it("lists users with live student counts and limits", async () => {
      const ana = buildUser({
        id: "u1",
        name: "Ana",
        settings: { limits: { ...DEFAULT_ACCOUNT_LIMITS, maxStudents: 10 } },
      });
      const bia = buildUser({ id: "u2", name: "Bia", email: "bia@x.com" });
      prisma.user.count.mockResolvedValue(2);
      prisma.user.findMany.mockResolvedValue([ana, bia]);
      clients.countByOwners.mockResolvedValue(new Map([["u1", 8]]));

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(clients.countByOwners).toHaveBeenCalledTimes(1);
      expect(clients.countByOwners).toHaveBeenCalledWith(["u1", "u2"]);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: "u1",
        studentsCount: 8,
        limits: {
          maxStudents: 10,
          canUploadVideos: true,
          whatsappAlerts: true,
        },
      });
      expect(result.items[1]).toMatchObject({
        id: "u2",
        studentsCount: 0,
        limits: DEFAULT_ACCOUNT_LIMITS,
      });
      expect(JSON.stringify(result)).not.toContain("hashedpassword");
    });

    it("paginates newest first and filters by status", async () => {
      prisma.user.count.mockResolvedValue(45);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.findAll({
        page: 3,
        limit: 20,
        status: "BLOCKED",
      });

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { status: "BLOCKED" },
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { status: "BLOCKED" },
        skip: 40,
        take: 20,
        orderBy: { createdAt: "desc" },
      });
      expect(result.totalPages).toBe(3);
    });

    it("defaults to page 1, 20 per page, and reports 1 page for an empty table", async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({
        where: {},
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({ items: [], total: 0, page: 1, totalPages: 1 });
    });

    it("does not hide a failing client directory", async () => {
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([buildUser()]);
      clients.countByOwners.mockRejectedValue(new Error("crm down"));

      await expect(service.findAll({})).rejects.toThrow("crm down");
    });
  });

  describe("findOne", () => {
    it("returns the user view without the password", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      const result = await service.findOne("user-uuid-1");

      expect(result.id).toBe("user-uuid-1");
      expect(result).not.toHaveProperty("password");
      expect(result.settings).toEqual(DEFAULT_USER_SETTINGS);
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne("ghost")).rejects.toThrow(NotFoundException);
    });
  });

  describe("update", () => {
    it("updates the status and merges the limits over the current ones, in one transaction", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      let limitsPatch: unknown;
      store.patchWithin.mockImplementation(
        async (_tx: unknown, _id: string, build: SettingsPatchBuilder) => {
          limitsPatch = build(DEFAULT_USER_SETTINGS);
        },
      );
      tx.user.update.mockResolvedValue(
        buildUser({
          status: "BLOCKED",
          settings: { limits: { ...DEFAULT_ACCOUNT_LIMITS, maxStudents: 100 } },
        }),
      );
      clients.countByOwners.mockResolvedValue(new Map([["user-uuid-1", 3]]));

      const result = await service.update("user-uuid-1", {
        status: "BLOCKED",
        limits: { maxStudents: 100 },
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(store.patchWithin).toHaveBeenCalledWith(
        tx,
        "user-uuid-1",
        expect.any(Function),
      );
      expect(limitsPatch).toEqual({
        limits: {
          maxStudents: 100,
          canUploadVideos: true,
          whatsappAlerts: true,
        },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        data: { status: "BLOCKED" },
      });
      expect(result).toMatchObject({
        id: "user-uuid-1",
        status: "BLOCKED",
        studentsCount: 3,
        limits: { maxStudents: 100 },
      });
    });

    it("does not touch the settings when only the status changes", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      tx.user.update.mockResolvedValue(buildUser({ status: "OVERDUE" }));

      const result = await service.update("user-uuid-1", { status: "OVERDUE" });

      expect(store.patchWithin).not.toHaveBeenCalled();
      expect(result.status).toBe("OVERDUE");
    });

    it("does not touch the status when only the limits change", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      tx.user.update.mockResolvedValue(buildUser());

      await service.update("user-uuid-1", {
        limits: { whatsappAlerts: false },
      });

      expect(store.patchWithin).toHaveBeenCalledTimes(1);
      expect(tx.user.update.mock.calls[0][0].data).toEqual({});
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update("ghost", { status: "BLOCKED" }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("hard-deletes the user", async () => {
      prisma.user.delete.mockResolvedValue(buildUser());

      await expect(service.remove("user-uuid-1")).resolves.toBeUndefined();
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
      });
    });

    it("throws NotFoundException when the user does not exist (P2025)", async () => {
      prisma.user.delete.mockRejectedValue(prismaError("P2025"));
      await expect(service.remove("ghost")).rejects.toThrow(NotFoundException);
    });

    it("rethrows any other database error untouched", async () => {
      prisma.user.delete.mockRejectedValue(new Error("connection lost"));
      await expect(service.remove("user-uuid-1")).rejects.toThrow(
        "connection lost",
      );
    });
  });
});
