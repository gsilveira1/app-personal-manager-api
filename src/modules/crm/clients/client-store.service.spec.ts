import { ConflictException, NotFoundException } from "@nestjs/common";

import { ClientStoreService } from "./client-store.service";

describe("ClientStoreService", () => {
  let store: ClientStoreService;
  let prisma: any;

  const userId = "trainer-1";
  const email = "maria@example.com";
  const values = {
    name: "Maria",
    phone: "53999001122",
    status: "LEAD" as const,
    modality: "ONLINE" as const,
    notes: null,
    planId: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
  };
  const include = { plan: { select: { id: true, name: true } } };

  beforeEach(() => {
    prisma = {
      client: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: "new-1" }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "old-1" }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      $transaction: jest.fn((run) => run(prisma)),
    };
    store = new ClientStoreService(prisma);
  });

  describe("resurrectOrCreate", () => {
    it("resurrects the soft-deleted client with the same e-mail and keeps its id", async () => {
      prisma.client.updateMany.mockResolvedValue({ count: 1 });

      const row = await store.resurrectOrCreate(userId, email, values, "dup");

      expect(prisma.client.updateMany).toHaveBeenCalledWith({
        where: { userId, email, deletedAt: { not: null } },
        data: { ...values, deletedAt: null },
      });
      expect(prisma.client.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { email_userId: { email, userId } },
        include,
      });
      expect(prisma.client.create).not.toHaveBeenCalled();
      expect(row.id).toBe("old-1");
    });

    it("creates a new client when there is nothing to resurrect", async () => {
      const row = await store.resurrectOrCreate(userId, email, values, "dup");

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: { ...values, email, userId },
        include,
      });
      expect(prisma.client.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(row.id).toBe("new-1");
    });

    it("runs both steps inside one transaction", async () => {
      await store.resurrectOrCreate(userId, email, values, "dup");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("answers 409 with the caller's message when the e-mail belongs to a live client", async () => {
      prisma.client.create.mockRejectedValue({ code: "P2002" });

      const attempt = store.resurrectOrCreate(userId, email, values, "taken");

      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow("taken");
    });

    it("never updates a live client", async () => {
      prisma.client.create.mockRejectedValue({ code: "P2002" });

      await expect(
        store.resurrectOrCreate(userId, email, values, "taken"),
      ).rejects.toThrow(ConflictException);

      expect(prisma.client.update).not.toHaveBeenCalled();
      expect(prisma.client.updateMany.mock.calls[0][0].where.deletedAt).toEqual(
        { not: null },
      );
    });

    it("rethrows any other error untouched", async () => {
      prisma.client.create.mockRejectedValue(new Error("DB connection lost"));

      await expect(
        store.resurrectOrCreate(userId, email, values, "dup"),
      ).rejects.toThrow("DB connection lost");
    });
  });

  describe("resurrectOrCreate with onResurrect (review H4: public lead form)", () => {
    const stored = {
      id: "old-1",
      name: "Maria Verdadeira",
      phone: "5553911112222",
      notes: "Histórico",
    };
    const kept = { status: "LEAD" as const, notes: "Histórico + lead" };
    const onResurrect = jest.fn().mockReturnValue(kept);

    beforeEach(() => onResurrect.mockClear());

    it("hands the stored name, phone and notes to the caller and writes only what it returns", async () => {
      prisma.client.findFirst.mockResolvedValue(stored);
      prisma.client.updateMany.mockResolvedValue({ count: 1 });

      const row = await store.resurrectOrCreate(
        userId,
        email,
        values,
        "dup",
        onResurrect,
      );

      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { userId, email, deletedAt: { not: null } },
        select: { id: true, name: true, phone: true, notes: true },
      });
      expect(onResurrect).toHaveBeenCalledWith({
        name: stored.name,
        phone: stored.phone,
        notes: stored.notes,
      });
      expect(prisma.client.updateMany).toHaveBeenCalledWith({
        where: { id: "old-1", userId, email, deletedAt: { not: null } },
        data: { ...kept, deletedAt: null },
      });
      const { data } = prisma.client.updateMany.mock.calls[0][0];
      expect(data).not.toHaveProperty("name");
      expect(data).not.toHaveProperty("phone");
      expect(prisma.client.create).not.toHaveBeenCalled();
      expect(row.id).toBe("old-1");
    });

    it("creates with the full values when there is no deleted client", async () => {
      await store.resurrectOrCreate(userId, email, values, "dup", onResurrect);

      expect(onResurrect).not.toHaveBeenCalled();
      expect(prisma.client.updateMany).not.toHaveBeenCalled();
      expect(prisma.client.create).toHaveBeenCalledWith({
        data: { ...values, email, userId },
        include,
      });
    });

    it("answers 409 when someone else resurrected the client in the meantime", async () => {
      prisma.client.findFirst.mockResolvedValue(stored);
      prisma.client.updateMany.mockResolvedValue({ count: 0 });
      prisma.client.create.mockRejectedValue({ code: "P2002" });

      await expect(
        store.resurrectOrCreate(userId, email, values, "taken", onResurrect),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("updateLive", () => {
    it("updates only a live client of the trainer", async () => {
      prisma.client.update.mockResolvedValue({ id: "client-1" });

      await store.updateLive(userId, "client-1", { name: "Nova" });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: "client-1", userId, deletedAt: null },
        data: { name: "Nova" },
        include,
      });
    });

    it("answers 404 when the client was deleted in the meantime (P2025)", async () => {
      prisma.client.update.mockRejectedValue({ code: "P2025" });

      await expect(
        store.updateLive(userId, "client-1", { name: "Nova" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("answers 409 when the e-mail is taken (P2002)", async () => {
      prisma.client.update.mockRejectedValue({ code: "P2002" });

      await expect(
        store.updateLive(userId, "client-1", { email: "x@example.com" }),
      ).rejects.toThrow(ConflictException);
    });

    it("rethrows any other error untouched", async () => {
      prisma.client.update.mockRejectedValue(new Error("boom"));

      await expect(store.updateLive(userId, "client-1", {})).rejects.toThrow(
        "boom",
      );
    });
  });
});
