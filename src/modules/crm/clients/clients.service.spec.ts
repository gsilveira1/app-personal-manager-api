import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";

import {
  ANAMNESIS_REQUESTER,
  CLIENT_DIRECTORY,
  WORKOUT_SHEET_READER,
} from "../../../common/ports";
import { GcsService } from "../../gcs/gcs.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PlansService } from "../plans/plans.service";
import { ClientStoreService } from "./client-store.service";
import { ClientsService } from "./clients.service";

describe("ClientsService", () => {
  let service: ClientsService;
  let prisma: any;
  let store: { resurrectOrCreate: jest.Mock; updateLive: jest.Mock };
  let plans: { requireAssignable: jest.Mock };
  let gcs: { generateSignedUploadUrl: jest.Mock };
  let directory: { requireOwned: jest.Mock };
  let sheets: { findActiveSummaries: jest.Mock };
  let anamnesis: { requestAnamnesis: jest.Mock };
  let logError: jest.SpyInstance;

  const userId = "trainer-uuid-1";
  const clientId = "client-uuid-1";
  const planId = "550e8400-e29b-41d4-a716-446655440000";

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: clientId,
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "53999001122",
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
    subscriptionStatus: null,
    currentPeriodEnd: null,
    gatewayCustomerId: null,
    userId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  });

  const dto = (overrides: Record<string, unknown> = {}) =>
    ({
      name: "Maria Santos",
      email: "maria@example.com",
      phone: "53999001122",
      ...overrides,
    }) as any;

  beforeEach(async () => {
    prisma = {
      client: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    store = {
      resurrectOrCreate: jest.fn().mockResolvedValue(row()),
      updateLive: jest.fn().mockResolvedValue(row()),
    };
    plans = { requireAssignable: jest.fn().mockResolvedValue(undefined) };
    gcs = { generateSignedUploadUrl: jest.fn() };
    directory = {
      requireOwned: jest
        .fn()
        .mockResolvedValue({ id: clientId, userId, email: row().email }),
    };
    sheets = { findActiveSummaries: jest.fn().mockResolvedValue(new Map()) };
    anamnesis = {
      requestAnamnesis: jest.fn().mockResolvedValue({
        assessmentId: "a-1",
        token: "t",
        link: "https://x/y",
        notification: { jobId: "j", status: "ENQUEUED", scheduledDelayMs: 0 },
      }),
    };
    logError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClientStoreService, useValue: store },
        { provide: PlansService, useValue: plans },
        { provide: GcsService, useValue: gcs },
        { provide: CLIENT_DIRECTORY, useValue: directory },
        { provide: WORKOUT_SHEET_READER, useValue: sheets },
        { provide: ANAMNESIS_REQUESTER, useValue: anamnesis },
      ],
    }).compile();
    service = moduleRef.get(ClientsService);
  });

  afterEach(() => jest.restoreAllMocks());

  const denyOwnership = (error: Error) =>
    directory.requireOwned.mockRejectedValue(error);

  describe("create", () => {
    it("creates (or resurrects) through the store with the trainer id and defaults", async () => {
      const result = await service.create(userId, dto());

      expect(store.resurrectOrCreate).toHaveBeenCalledWith(
        userId,
        "maria@example.com",
        expect.objectContaining({
          name: "Maria Santos",
          phone: "53999001122",
          status: "ACTIVE",
          modality: "PRESENCIAL",
          notificationEnabled: true,
          planId: null,
          subscriptionStatus: null,
          currentPeriodEnd: null,
        }),
        "Email already exists",
      );
      expect(result.name).toBe("Maria Santos");
    });

    it("stores the e-mail lower-cased and trimmed", async () => {
      await service.create(userId, dto({ email: "  Maria@Example.COM " }));

      expect(store.resurrectOrCreate.mock.calls[0][1]).toBe(
        "maria@example.com",
      );
    });

    it("uses the status from the body, also when resurrecting", async () => {
      await service.create(userId, dto({ status: "LEAD", modality: "ONLINE" }));

      expect(store.resurrectOrCreate.mock.calls[0][2]).toMatchObject({
        status: "LEAD",
        modality: "ONLINE",
      });
    });

    it("stores medicalHistory as a plain JSON document", async () => {
      const medicalHistory = { objective: ["Saúde"], hasHeartDisease: false };

      await service.create(userId, dto({ medicalHistory }));

      expect(store.resurrectOrCreate.mock.calls[0][2].medicalHistory).toEqual(
        medicalHistory,
      );
    });

    it("persists checkInFrequency as checkInFreq (the alias wins)", async () => {
      await service.create(
        userId,
        dto({ checkInFrequency: "Weekly", checkInFreq: "Monthly" }),
      );

      expect(store.resurrectOrCreate.mock.calls[0][2].checkInFreq).toBe(
        "Weekly",
      );
    });

    it("parses dateOfBirth into a Date", async () => {
      await service.create(userId, dto({ dateOfBirth: "1995-03-15" }));

      expect(store.resurrectOrCreate.mock.calls[0][2].dateOfBirth).toEqual(
        new Date("1995-03-15"),
      );
    });

    it("propagates the 409 of a live client's e-mail and sends no welcome", async () => {
      store.resurrectOrCreate.mockRejectedValue(
        new ConflictException("Email already exists"),
      );

      await expect(service.create(userId, dto())).rejects.toThrow(
        ConflictException,
      );
      expect(anamnesis.requestAnamnesis).not.toHaveBeenCalled();
    });

    it("rethrows unexpected database errors", async () => {
      store.resurrectOrCreate.mockRejectedValue(
        new Error("DB connection lost"),
      );

      await expect(service.create(userId, dto())).rejects.toThrow(
        "DB connection lost",
      );
    });

    it("rejects a planId that is not one of the trainer's plans before writing", async () => {
      plans.requireAssignable.mockRejectedValue(new BadRequestException());

      await expect(service.create(userId, dto({ planId }))).rejects.toThrow(
        BadRequestException,
      );
      expect(plans.requireAssignable).toHaveBeenCalledWith(userId, planId);
      expect(store.resurrectOrCreate).not.toHaveBeenCalled();
    });

    describe("welcome message", () => {
      it("is QUEUED when the anamnesis request is accepted", async () => {
        const result = await service.create(userId, dto());

        expect(anamnesis.requestAnamnesis).toHaveBeenCalledWith(
          userId,
          clientId,
          { notify: true },
        );
        expect(result.welcomeMessage).toBe("QUEUED");
      });

      it("is SKIPPED when notifications are off", async () => {
        store.resurrectOrCreate.mockResolvedValue(
          row({ notificationEnabled: false }),
        );

        const result = await service.create(
          userId,
          dto({ notificationEnabled: false }),
        );

        expect(result.welcomeMessage).toBe("SKIPPED");
        expect(anamnesis.requestAnamnesis).not.toHaveBeenCalled();
      });

      it("is SKIPPED when the client has no phone", async () => {
        store.resurrectOrCreate.mockResolvedValue(row({ phone: "  " }));

        const result = await service.create(userId, dto({ phone: "  " }));

        expect(result.welcomeMessage).toBe("SKIPPED");
        expect(anamnesis.requestAnamnesis).not.toHaveBeenCalled();
      });

      it("is FAILED, logged with the upstream status, and the client is still returned", async () => {
        anamnesis.requestAnamnesis.mockRejectedValue(
          new ServiceUnavailableException("queue unreachable"),
        );

        const result = await service.create(userId, dto());

        expect(result.welcomeMessage).toBe("FAILED");
        expect(result.id).toBe(clientId);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError.mock.calls[0][0]).toContain(clientId);
        expect(logError.mock.calls[0][0]).toContain("HTTP 503");
        expect(logError.mock.calls[0][0]).toContain("queue unreachable");
      });

      it("is FAILED and logged for a non-HTTP error too", async () => {
        anamnesis.requestAnamnesis.mockRejectedValue(new Error("boom"));

        const result = await service.create(userId, dto());

        expect(result.welcomeMessage).toBe("FAILED");
        expect(logError.mock.calls[0][0]).toContain("boom");
        expect(logError.mock.calls[0][1]).toEqual(expect.any(String));
      });
    });
  });

  describe("findPage", () => {
    it("returns a page of live clients with their active sheet (one reader call)", async () => {
      prisma.client.count.mockResolvedValue(41);
      prisma.client.findMany.mockResolvedValue([
        row({ checkInFreq: "Bi-weekly" }),
        row({ id: "client-2" }),
      ]);
      sheets.findActiveSummaries.mockResolvedValue(
        new Map([[clientId, { id: "s-1", name: "Ficha A", expiresAt: null }]]),
      );

      const page = await service.findPage(userId, { page: 2, limit: 20 });

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        skip: 20,
        take: 20,
        include: { plan: { select: { id: true, name: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      expect(prisma.client.count).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
      });
      expect(sheets.findActiveSummaries).toHaveBeenCalledTimes(1);
      expect(sheets.findActiveSummaries).toHaveBeenCalledWith(userId, [
        clientId,
        "client-2",
      ]);
      expect(page).toMatchObject({ total: 41, page: 2, totalPages: 3 });
      expect(page.items[0].activeWorkoutSheet).toEqual({
        id: "s-1",
        name: "Ficha A",
        expiresAt: null,
      });
      expect(page.items[0].checkInFrequency).toBe("Bi-weekly");
      expect(page.items[0].checkInFreq).toBe("Bi-weekly");
      expect(page.items[1].activeWorkoutSheet).toBeNull();
    });

    it("defaults to page 1, 20 per page and one total page when empty", async () => {
      const page = await service.findPage(userId, {});

      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(page).toEqual({ items: [], total: 0, page: 1, totalPages: 1 });
    });

    it("applies filters and sorting from the query", async () => {
      await service.findPage(userId, {
        status: "pausada",
        sortBy: "createdAt",
        sortOrder: "desc",
      });

      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, deletedAt: null, status: "PAUSED" },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        }),
      );
    });

    it("does not swallow a failure of the workout sheet reader", async () => {
      sheets.findActiveSummaries.mockRejectedValue(new Error("reader down"));

      await expect(service.findPage(userId, {})).rejects.toThrow("reader down");
    });
  });

  describe("findLeads", () => {
    it("returns live LEAD clients, newest first", async () => {
      prisma.client.findMany.mockResolvedValue([row({ status: "LEAD" })]);

      const result = await service.findLeads(userId);

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { userId, status: "LEAD", deletedAt: null },
        include: { plan: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("LEAD");
    });

    it("returns an empty array when there are no leads", async () => {
      await expect(service.findLeads(userId)).resolves.toEqual([]);
    });
  });

  describe("exportCsv", () => {
    it("exports live clients ordered by name", async () => {
      prisma.client.findMany.mockResolvedValue([row()]);

      const csv = await service.exportCsv(userId);

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        orderBy: { name: "asc" },
      });
      expect(csv.split("\n")).toHaveLength(2);
      expect(csv).toContain('"Maria Santos"');
    });
  });

  describe("findOne", () => {
    it("returns the client with its full plan and payments, newest first", async () => {
      prisma.client.findFirst.mockResolvedValue(row({ payments: [] }));

      const result = await service.findOne(userId, clientId);

      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { id: clientId, deletedAt: null },
        include: {
          plan: {
            include: {
              _count: { select: { clients: { where: { deletedAt: null } } } },
            },
          },
          payments: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
        },
      });
      expect(result.id).toBe(clientId);
      expect(result.payments).toEqual([]);
      expect(result).not.toHaveProperty("workoutSheets");
      expect(result).not.toHaveProperty("anamneses");
    });

    it("answers 404 when the client does not exist or is soft-deleted", async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await expect(service.findOne(userId, "gone")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("answers 403 when the client belongs to another trainer", async () => {
      prisma.client.findFirst.mockResolvedValue(
        row({ userId: "other-user", payments: [] }),
      );

      await expect(service.findOne(userId, clientId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("update", () => {
    it("updates after the ownership check and writes only what the body carries", async () => {
      store.updateLive.mockResolvedValue(row({ name: "Maria Updated" }));

      const result = await service.update(userId, clientId, {
        name: "Maria Updated",
      });

      expect(directory.requireOwned).toHaveBeenCalledWith(userId, clientId);
      const data = store.updateLive.mock.calls[0][2];
      expect(store.updateLive.mock.calls[0].slice(0, 2)).toEqual([
        userId,
        clientId,
      ]);
      expect(JSON.parse(JSON.stringify(data))).toEqual({
        name: "Maria Updated",
      });
      expect(result.name).toBe("Maria Updated");
    });

    it.each([
      [new ForbiddenException(), ForbiddenException],
      [new NotFoundException(), NotFoundException],
    ])(
      "does not write when the ownership check fails (%p)",
      async (e, type) => {
        denyOwnership(e);

        await expect(
          service.update(userId, clientId, { name: "x" }),
        ).rejects.toThrow(type);
        expect(store.updateLive).not.toHaveBeenCalled();
      },
    );

    it("stores medicalHistory as a plain JSON document", async () => {
      const medicalHistory = { objective: ["Hipertrofia"], smoker: false };

      await service.update(userId, clientId, { medicalHistory });

      expect(store.updateLive.mock.calls[0][2].medicalHistory).toEqual(
        medicalHistory,
      );
    });

    it("unlinks the plan with planId null and validates a new planId", async () => {
      await service.update(userId, clientId, { planId: null });
      expect(store.updateLive.mock.calls[0][2].planId).toBeNull();
      expect(plans.requireAssignable).not.toHaveBeenCalled();

      await service.update(userId, clientId, { planId });
      expect(plans.requireAssignable).toHaveBeenCalledWith(userId, planId);
    });

    it("rejects another trainer's planId with 400", async () => {
      plans.requireAssignable.mockRejectedValue(new BadRequestException());

      await expect(
        service.update(userId, clientId, { planId }),
      ).rejects.toThrow(BadRequestException);
      expect(store.updateLive).not.toHaveBeenCalled();
    });

    it("ignores null for columns that cannot be null", async () => {
      await service.update(userId, clientId, {
        name: null,
        phone: null,
        status: null,
      } as any);

      expect(
        JSON.parse(JSON.stringify(store.updateLive.mock.calls[0][2])),
      ).toEqual({});
    });

    it("answers 409 when the new e-mail is held by another row, live or deleted", async () => {
      prisma.client.findFirst.mockResolvedValue({ id: "other" });

      await expect(
        service.update(userId, clientId, { email: "Taken@Example.com" }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { userId, email: "taken@example.com", id: { not: clientId } },
        select: { id: true },
      });
      expect(store.updateLive).not.toHaveBeenCalled();
    });

    it("normalises a changed e-mail and skips the lookup when it did not change", async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await service.update(userId, clientId, { email: " New@Example.com " });
      expect(store.updateLive.mock.calls[0][2].email).toBe("new@example.com");

      prisma.client.findFirst.mockClear();
      await service.update(userId, clientId, { email: "MARIA@example.com" });
      expect(prisma.client.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("updateStatus", () => {
    it("changes the status after the ownership check", async () => {
      store.updateLive.mockResolvedValue(row({ status: "PAUSED" }));

      const result = await service.updateStatus(userId, clientId, "PAUSED");

      expect(directory.requireOwned).toHaveBeenCalledWith(userId, clientId);
      expect(store.updateLive).toHaveBeenCalledWith(userId, clientId, {
        status: "PAUSED",
      });
      expect(result.status).toBe("PAUSED");
    });

    it("answers 404 for a soft-deleted client", async () => {
      denyOwnership(new NotFoundException());

      await expect(
        service.updateStatus(userId, clientId, "PAUSED"),
      ).rejects.toThrow(NotFoundException);
      expect(store.updateLive).not.toHaveBeenCalled();
    });
  });

  describe("convertLead", () => {
    it("sets the status to ACTIVE", async () => {
      store.updateLive.mockResolvedValue(row({ status: "ACTIVE" }));

      const result = await service.convertLead(userId, clientId);

      expect(store.updateLive).toHaveBeenCalledWith(userId, clientId, {
        status: "ACTIVE",
      });
      expect(plans.requireAssignable).not.toHaveBeenCalled();
      expect(result.status).toBe("ACTIVE");
    });

    it("assigns the plan when given", async () => {
      await service.convertLead(userId, clientId, planId);

      expect(plans.requireAssignable).toHaveBeenCalledWith(userId, planId);
      expect(store.updateLive).toHaveBeenCalledWith(userId, clientId, {
        status: "ACTIVE",
        planId,
      });
    });

    it("answers 400 when the plan is not one of the trainer's plans", async () => {
      plans.requireAssignable.mockRejectedValue(new BadRequestException());

      await expect(
        service.convertLead(userId, clientId, planId),
      ).rejects.toThrow(BadRequestException);
      expect(store.updateLive).not.toHaveBeenCalled();
    });

    it("answers 404 for a missing client and 403 for another trainer's", async () => {
      denyOwnership(new NotFoundException());
      await expect(service.convertLead(userId, "gone")).rejects.toThrow(
        NotFoundException,
      );

      denyOwnership(new ForbiddenException());
      await expect(service.convertLead(userId, clientId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("generateAvatarUploadUrl", () => {
    it("returns a signed URL after the ownership check", async () => {
      gcs.generateSignedUploadUrl.mockResolvedValue({
        uploadUrl: "https://storage.googleapis.com/signed-url",
        publicUrl: `https://storage.googleapis.com/bucket/avatars/${userId}/${clientId}.jpeg`,
      });

      const result = await service.generateAvatarUploadUrl(
        userId,
        clientId,
        "image/jpeg",
      );

      expect(gcs.generateSignedUploadUrl).toHaveBeenCalledWith(
        `avatars/${userId}/${clientId}.jpeg`,
        "image/jpeg",
      );
      expect(result.publicUrl).toContain(clientId);
    });

    it("answers 404 / 403 without asking for a URL", async () => {
      denyOwnership(new NotFoundException());
      await expect(
        service.generateAvatarUploadUrl(userId, "gone", "image/png"),
      ).rejects.toThrow(NotFoundException);

      denyOwnership(new ForbiddenException());
      await expect(
        service.generateAvatarUploadUrl(userId, clientId, "image/png"),
      ).rejects.toThrow(ForbiddenException);
      expect(gcs.generateSignedUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe("remove (soft delete)", () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
    });
    afterEach(() => jest.useRealTimers());

    it("marks the client deleted and cancels the subscription in one update", async () => {
      await service.remove(userId, clientId);

      expect(prisma.client.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.updateMany).toHaveBeenCalledWith({
        where: { id: clientId, userId, deletedAt: null },
        data: {
          deletedAt: new Date("2026-10-03T12:00:00.000Z"),
          subscriptionStatus: "CANCELED",
        },
      });
    });

    it("answers 404 on a second call (the directory no longer sees the client)", async () => {
      denyOwnership(new NotFoundException());

      await expect(service.remove(userId, clientId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.client.updateMany).not.toHaveBeenCalled();
    });

    it("answers 404 when a concurrent call deleted it first", async () => {
      prisma.client.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(userId, clientId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("answers 403 for another trainer's client", async () => {
      denyOwnership(new ForbiddenException());

      await expect(service.remove(userId, clientId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.client.updateMany).not.toHaveBeenCalled();
    });
  });

  it("every direct Client query hides soft-deleted rows", async () => {
    prisma.client.findFirst.mockResolvedValue(row({ payments: [] }));

    await service.findPage(userId, {});
    await service.findLeads(userId);
    await service.exportCsv(userId);
    await service.findOne(userId, clientId);
    await service.remove(userId, clientId);

    const wheres = [
      ...prisma.client.findMany.mock.calls,
      ...prisma.client.count.mock.calls,
      ...prisma.client.findFirst.mock.calls,
      ...prisma.client.updateMany.mock.calls,
    ].map(([args]) => args.where);
    expect(wheres).toHaveLength(6);
    for (const where of wheres) {
      expect(where).toMatchObject({ deletedAt: null });
    }
  });
});
