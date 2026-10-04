import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { USER_DIRECTORY, UserDirectory } from "../../common/ports";
import { DEFAULT_USER_SETTINGS } from "../../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { buildUser, prismaError } from "./testing";
import { UserDirectoryService } from "./user-directory.service";
import { UserSettingsStore } from "./user-settings.store";
import { TRAINER_PROFILE_SELECT } from "./user-view";

describe("UserDirectoryService (USER_DIRECTORY)", () => {
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let store: { read: jest.Mock };
  let directory: UserDirectory;

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    store = { read: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        UserDirectoryService,
        { provide: USER_DIRECTORY, useExisting: UserDirectoryService },
        { provide: PrismaService, useValue: prisma },
        { provide: UserSettingsStore, useValue: store },
      ],
    }).compile();
    directory = module.get<UserDirectory>(USER_DIRECTORY);
  });

  describe("requireBySlug", () => {
    it("returns the trainer profile, without credentials", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ phone: "5399" }));

      const profile = await directory.requireBySlug("joao-silva");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { slug: "joao-silva" },
        select: TRAINER_PROFILE_SELECT,
      });
      expect(profile).toEqual({
        id: "user-uuid-1",
        name: "João Silva",
        phone: "5399",
        slug: "joao-silva",
        status: "ACTIVE",
        primaryColor: "#10B981",
        logoUrl: null,
      });
    });

    it("throws NotFoundException for an unknown slug", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(directory.requireBySlug("nobody")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getProfile", () => {
    it("looks the trainer up by id", async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ status: "BLOCKED", primaryColor: null }),
      );

      const profile = await directory.getProfile("user-uuid-1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        select: TRAINER_PROFILE_SELECT,
      });
      expect(profile.status).toBe("BLOCKED");
      expect(profile.primaryColor).toBe("#10B981");
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(directory.getProfile("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it("getSettings returns the resolved settings from the store", async () => {
    store.read.mockResolvedValue(DEFAULT_USER_SETTINGS);
    await expect(directory.getSettings("u1")).resolves.toBe(
      DEFAULT_USER_SETTINGS,
    );
    expect(store.read).toHaveBeenCalledWith("u1");
  });

  describe("getWhatsappConnection", () => {
    it("maps the two columns to the connection", async () => {
      prisma.user.findUnique.mockResolvedValue({
        whatsappInstanceName: "user-abcdef12",
        whatsappStatus: "CONNECTED",
      });

      await expect(directory.getWhatsappConnection("u1")).resolves.toEqual({
        instanceName: "user-abcdef12",
        status: "CONNECTED",
      });
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(directory.getWhatsappConnection("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("setWhatsappConnection", () => {
    it("updates only the keys present in the patch", async () => {
      prisma.user.update.mockResolvedValue({
        whatsappInstanceName: "user-abcdef12",
        whatsappStatus: "DISCONNECTED",
      });

      const result = await directory.setWhatsappConnection("u1", {
        status: "DISCONNECTED",
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { whatsappStatus: "DISCONNECTED" },
        select: { whatsappInstanceName: true, whatsappStatus: true },
      });
      expect(result).toEqual({
        instanceName: "user-abcdef12",
        status: "DISCONNECTED",
      });
    });

    it("can set the instance name and clear it with null", async () => {
      prisma.user.update.mockResolvedValue({
        whatsappInstanceName: null,
        whatsappStatus: "PENDING",
      });

      await directory.setWhatsappConnection("u1", {
        instanceName: null,
        status: "PENDING",
      });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        whatsappInstanceName: null,
        whatsappStatus: "PENDING",
      });
    });

    it("throws NotFoundException when the user does not exist (P2025)", async () => {
      prisma.user.update.mockRejectedValue(prismaError("P2025"));
      await expect(
        directory.setWhatsappConnection("ghost", { status: "PENDING" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException when the instance name belongs to another account (P2002)", async () => {
      prisma.user.update.mockRejectedValue(prismaError("P2002"));
      await expect(
        directory.setWhatsappConnection("u1", {
          instanceName: "user-abcdef12",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("rethrows any other error untouched", async () => {
      prisma.user.update.mockRejectedValue(new Error("connection lost"));
      await expect(
        directory.setWhatsappConnection("u1", { status: "PENDING" }),
      ).rejects.toThrow("connection lost");
    });
  });
});
