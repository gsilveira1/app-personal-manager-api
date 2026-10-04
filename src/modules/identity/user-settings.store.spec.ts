import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DEFAULT_DND, DEFAULT_USER_SETTINGS } from "../../common/types";
import { definedOnly, UserSettingsStore } from "./user-settings.store";

describe("UserSettingsStore", () => {
  let tx: { $queryRaw: jest.Mock; user: { update: jest.Mock } };
  let prisma: { user: { findUnique: jest.Mock }; $transaction: jest.Mock };
  let store: UserSettingsStore;

  beforeEach(() => {
    tx = { $queryRaw: jest.fn(), user: { update: jest.fn() } };
    prisma = {
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((run) => run(tx)),
    };
    store = new UserSettingsStore(prisma as any);
  });

  describe("read", () => {
    it("returns the stored settings with defaults applied", async () => {
      prisma.user.findUnique.mockResolvedValue({
        settings: { language: "es" },
      });

      const settings = await store.read("u1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: { settings: true },
      });
      expect(settings).toEqual({ ...DEFAULT_USER_SETTINGS, language: "es" });
    });

    it("returns the defaults for an account that never saved settings", async () => {
      prisma.user.findUnique.mockResolvedValue({ settings: null });
      await expect(store.read("u1")).resolves.toEqual(DEFAULT_USER_SETTINGS);
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(store.read("ghost")).rejects.toThrow(NotFoundException);
    });

    it("bubbles up Prisma errors without masking", async () => {
      prisma.user.findUnique.mockRejectedValue(new Error("connection lost"));
      await expect(store.read("u1")).rejects.toThrow("connection lost");
    });
  });

  describe("patch", () => {
    it("locks the row, replaces the given keys and keeps the others", async () => {
      tx.$queryRaw.mockResolvedValue([
        { settings: { language: "en", aiInstructions: "be brief" } },
      ]);

      const result = await store.patch("u1", () => ({ language: "es" }));

      const [sql, userId] = tx.$queryRaw.mock.calls[0];
      expect(sql.join("?")).toContain("FOR UPDATE");
      expect(userId).toBe("u1");
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { settings: { language: "es", aiInstructions: "be brief" } },
      });
      expect(result.language).toBe("es");
      expect(result.aiInstructions).toBe("be brief");
      expect(result.dnd).toEqual(DEFAULT_DND);
    });

    it("hands the resolved current settings to the patch builder", async () => {
      tx.$queryRaw.mockResolvedValue([{ settings: null }]);
      const build = jest.fn().mockReturnValue({});

      await store.patch("u1", build);

      expect(build).toHaveBeenCalledWith(DEFAULT_USER_SETTINGS);
    });

    it("throws NotFoundException and writes nothing when the user does not exist", async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(store.patch("ghost", () => ({}))).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("rejects an invalid document with 400 and writes nothing", async () => {
      tx.$queryRaw.mockResolvedValue([{ settings: {} }]);

      await expect(
        store.patch("u1", () => ({ language: "fr" as any })),
      ).rejects.toThrow(BadRequestException);
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("bubbles up a failed write without masking", async () => {
      tx.$queryRaw.mockResolvedValue([{ settings: {} }]);
      tx.user.update.mockRejectedValue(new Error("write failed"));

      await expect(
        store.patch("u1", () => ({ language: "en" })),
      ).rejects.toThrow("write failed");
    });
  });

  it("definedOnly drops undefined values and keeps falsy ones", () => {
    expect(definedOnly({ a: undefined, b: false, c: 0, d: "x" })).toEqual({
      b: false,
      c: 0,
      d: "x",
    });
  });
});
