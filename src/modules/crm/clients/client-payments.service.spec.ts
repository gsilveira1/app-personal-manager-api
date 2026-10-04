import { ForbiddenException, NotFoundException } from "@nestjs/common";

import { ClientPaymentsService } from "./client-payments.service";

describe("ClientPaymentsService", () => {
  let service: ClientPaymentsService;
  let prisma: any;
  let directory: { requireOwned: jest.Mock };

  const userId = "trainer-1";
  const clientId = "client-1";
  const now = new Date("2026-10-03T12:00:00.000Z");
  const dto = {
    amount: 150,
    method: "PIX" as const,
    periodEnd: "2026-11-03T00:00:00.000Z",
    notes: "Pago via Pix",
  };

  const paymentRow = {
    id: "pay-1",
    clientId,
    userId,
    provider: "MANUAL",
    status: "PAID",
    amount: 150,
    method: "PIX",
    externalId: null,
    date: now,
    periodEnd: new Date(dto.periodEnd),
    notes: "Pago via Pix",
    createdAt: now,
    updatedAt: now,
  };
  const clientRow = {
    id: clientId,
    name: "Maria",
    email: "maria@example.com",
    phone: "53",
    status: "ACTIVE",
    modality: "PRESENCIAL",
    goal: null,
    avatar: null,
    notes: null,
    dateOfBirth: null,
    checkInFreq: null,
    medicalHistory: null,
    notificationEnabled: true,
    deletedAt: null,
    planId: null,
    plan: null,
    subscriptionStatus: "ACTIVE",
    currentPeriodEnd: new Date(dto.periodEnd),
    gatewayCustomerId: null,
    userId,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = {
      payment: { create: jest.fn().mockReturnValue("payment-op") },
      client: { update: jest.fn().mockReturnValue("client-op") },
      $transaction: jest.fn().mockResolvedValue([paymentRow, clientRow]),
    };
    directory = { requireOwned: jest.fn().mockResolvedValue({ id: clientId }) };
    service = new ClientPaymentsService(prisma, directory as any);
  });

  afterEach(() => jest.useRealTimers());

  it("creates a MANUAL / PAID payment dated now", async () => {
    await service.record(userId, clientId, dto);

    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: {
        clientId,
        userId,
        provider: "MANUAL",
        status: "PAID",
        amount: 150,
        method: "PIX",
        date: now,
        periodEnd: new Date(dto.periodEnd),
        notes: "Pago via Pix",
      },
    });
  });

  it("reactivates the client and its subscription until periodEnd", async () => {
    await service.record(userId, clientId, dto);

    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: clientId, userId, deletedAt: null },
      data: {
        status: "ACTIVE",
        currentPeriodEnd: new Date(dto.periodEnd),
        subscriptionStatus: "ACTIVE",
      },
      include: { plan: { select: { id: true, name: true } } },
    });
  });

  it("writes both rows in one transaction", async () => {
    await service.record(userId, clientId, dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith([
      "payment-op",
      "client-op",
    ]);
  });

  it("returns the message, the payment view and the client view", async () => {
    const result = await service.record(userId, clientId, dto);

    expect(result.message).toBe("Pagamento manual registrado com sucesso");
    expect(result.payment).toMatchObject({
      id: "pay-1",
      provider: "MANUAL",
      status: "PAID",
      amount: 150,
      method: "PIX",
      periodEnd: "2026-11-03T00:00:00.000Z",
    });
    expect(result.client).toMatchObject({
      id: clientId,
      status: "ACTIVE",
      subscriptionStatus: "ACTIVE",
      currentPeriodEnd: "2026-11-03T00:00:00.000Z",
    });
  });

  it.each([
    [new NotFoundException(), NotFoundException],
    [new ForbiddenException(), ForbiddenException],
  ])("writes nothing when the ownership check fails (%p)", async (e, type) => {
    directory.requireOwned.mockRejectedValue(e);

    await expect(service.record(userId, clientId, dto)).rejects.toThrow(type);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answers 404 when the client is deleted between the check and the write", async () => {
    prisma.$transaction.mockRejectedValue({ code: "P2025" });

    await expect(service.record(userId, clientId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("propagates a failed transaction (nothing is half-written)", async () => {
    prisma.$transaction.mockRejectedValue(new Error("tx aborted"));

    await expect(service.record(userId, clientId, dto)).rejects.toThrow(
      "tx aborted",
    );
  });
});
