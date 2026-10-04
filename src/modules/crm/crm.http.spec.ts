import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { JwtAuthGuard } from "../../common/auth";
import {
  ANAMNESIS_REQUESTER,
  CLIENT_DIRECTORY,
  USER_DIRECTORY,
  WORKOUT_SHEET_READER,
} from "../../common/ports";
import { GcsService } from "../gcs/gcs.service";
import { PrismaService } from "../prisma/prisma.service";
import { ClientDirectoryService } from "./client-directory.service";
import { CRM_CONTROLLERS, CRM_PROVIDERS } from "./crm.providers";
import { CrmModule } from "./crm.module";

const TRAINER = "trainer-1";
const OTHER = "trainer-2";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-03T12:00:00.000Z");

/** Stands in for the passport strategy registered by the identity module. */
class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers["x-test-user"];
    if (!userId) throw new UnauthorizedException();
    req.user = { userId, username: "t@example.com", role: "trainer" };
    return true;
  }
}

const clientRow = (overrides: Record<string, unknown> = {}) => ({
  id: CLIENT_ID,
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
  userId: TRAINER,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

/**
 * The module's real controllers, services, DTOs and ClientDirectory behind HTTP, with
 * the same ValidationPipe as main.ts. Only Prisma, GCS and the other streams' ports
 * are mocked.
 */
describe("crm over HTTP", () => {
  let app: INestApplication;
  let prisma: any;
  let users: { requireBySlug: jest.Mock };
  let anamnesis: { requestAnamnesis: jest.Mock };
  let sheets: { findActiveSummaries: jest.Mock };

  const api = () => request(app.getHttpServer());
  const asTrainer = (test: request.Test) => test.set("x-test-user", TRAINER);

  beforeEach(async () => {
    prisma = {
      client: {
        findFirst: jest.fn().mockResolvedValue(clientRow()),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(clientRow()),
        update: jest.fn().mockResolvedValue(clientRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        groupBy: jest.fn(),
      },
      plan: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: PLAN_ID }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      payment: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn((arg) =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg),
    );
    users = { requireBySlug: jest.fn().mockResolvedValue({ id: TRAINER }) };
    sheets = { findActiveSummaries: jest.fn().mockResolvedValue(new Map()) };
    anamnesis = { requestAnamnesis: jest.fn().mockResolvedValue({}) };

    const moduleRef = await Test.createTestingModule({
      controllers: CRM_CONTROLLERS,
      providers: [
        ...CRM_PROVIDERS,
        ClientDirectoryService,
        { provide: CLIENT_DIRECTORY, useExisting: ClientDirectoryService },
        { provide: PrismaService, useValue: prisma },
        {
          provide: GcsService,
          useValue: { generateSignedUploadUrl: jest.fn() },
        },
        { provide: USER_DIRECTORY, useValue: users },
        { provide: WORKOUT_SHEET_READER, useValue: sheets },
        { provide: ANAMNESIS_REQUESTER, useValue: anamnesis },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthGuard)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterEach(() => app.close());

  it("CrmModule registers the same controllers and providers this spec exercises", () => {
    expect(Reflect.getMetadata("controllers", CrmModule)).toBe(CRM_CONTROLLERS);
    expect(Reflect.getMetadata("providers", CrmModule)).toBe(CRM_PROVIDERS);
  });

  describe("access", () => {
    it.each([
      ["post", "/clients"],
      ["get", "/clients"],
      ["get", "/clients/leads"],
      ["get", "/clients/export/csv"],
      ["get", `/clients/${CLIENT_ID}`],
      ["patch", `/clients/${CLIENT_ID}`],
      ["patch", `/clients/${CLIENT_ID}/status`],
      ["patch", `/clients/${CLIENT_ID}/convert`],
      ["post", `/clients/${CLIENT_ID}/avatar-upload-url`],
      ["delete", `/clients/${CLIENT_ID}`],
      ["post", `/clients/${CLIENT_ID}/payments`],
      ["post", "/plans"],
      ["get", "/plans"],
      ["get", `/plans/${PLAN_ID}`],
      ["patch", `/plans/${PLAN_ID}`],
      ["delete", `/plans/${PLAN_ID}`],
      ["get", "/plan-features"],
    ] as const)("%s %s answers 401 without a token", async (method, path) => {
      await api()[method](path).expect(401);
    });

    it("the public routes need no token", async () => {
      await api().get("/public/vivi/plans").expect(200);
      await api()
        .post("/public/vivi/leads")
        .send({
          name: "C",
          email: "c@x.com",
          phone: "53999001122",
          interest: "online",
        })
        .expect(201);
    });
  });

  describe("POST /clients", () => {
    const body = { name: "Maria", email: "Maria@Example.com", phone: "5399" };

    it("answers 201 with the view and the welcome outcome", async () => {
      const res = await asTrainer(api().post("/clients"))
        .send(body)
        .expect(201);

      expect(res.body).toMatchObject({
        id: CLIENT_ID,
        welcomeMessage: "QUEUED",
        checkInFrequency: null,
        createdAt: NOW.toISOString(),
      });
      expect(res.body).not.toHaveProperty("deletedAt");
      expect(prisma.client.create.mock.calls[0][0].data).toMatchObject({
        email: "maria@example.com",
        userId: TRAINER,
        status: "ACTIVE",
      });
    });

    it("resurrects a soft-deleted client instead of creating one", async () => {
      prisma.client.updateMany.mockResolvedValue({ count: 1 });
      prisma.client.findUniqueOrThrow.mockResolvedValue(clientRow());

      await asTrainer(api().post("/clients")).send(body).expect(201);

      expect(prisma.client.create).not.toHaveBeenCalled();
      expect(prisma.client.updateMany.mock.calls[0][0]).toMatchObject({
        where: {
          userId: TRAINER,
          email: "maria@example.com",
          deletedAt: { not: null },
        },
        data: { deletedAt: null, status: "ACTIVE" },
      });
    });

    it("answers 409 when the e-mail belongs to a live client", async () => {
      prisma.client.create.mockRejectedValue({ code: "P2002" });

      const res = await asTrainer(api().post("/clients"))
        .send(body)
        .expect(409);

      expect(res.body.message).toBe("Email already exists");
    });

    it.each([
      [{ type: "Online" }],
      [{ subscriptionStatus: "ACTIVE" }],
      [{ userId: OTHER }],
      [{ deletedAt: null }],
      [{ email: "nope" }],
      [{ status: "whatever" }],
    ])("answers 400 for %p", async (extra) => {
      await asTrainer(api().post("/clients"))
        .send({ ...body, ...extra })
        .expect(400);
      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it("answers 400 when planId is not one of the trainer's plans", async () => {
      prisma.plan.findFirst.mockResolvedValue(null);

      await asTrainer(api().post("/clients"))
        .send({ ...body, planId: PLAN_ID })
        .expect(400);
      expect(prisma.client.create).not.toHaveBeenCalled();
    });
  });

  describe("GET /clients", () => {
    it("answers a page and coerces the query", async () => {
      prisma.client.count.mockResolvedValue(1);
      prisma.client.findMany.mockResolvedValue([clientRow()]);

      const res = await asTrainer(
        api().get("/clients?page=2&limit=500&status=ativo&sortOrder=DESC"),
      ).expect(200);

      expect(res.body).toMatchObject({ total: 1, page: 2, totalPages: 1 });
      expect(res.body.items[0].activeWorkoutSheet).toBeNull();
      expect(prisma.client.findMany.mock.calls[0][0]).toMatchObject({
        where: { userId: TRAINER, deletedAt: null, status: "ACTIVE" },
        skip: 500,
        take: 500,
        orderBy: [{ name: "desc" }, { id: "asc" }],
      });
    });

    it.each([["limit=501"], ["limit=0"], ["page=0"], ["foo=bar"]])(
      "answers 400 for ?%s",
      async (query) => {
        await asTrainer(api().get(`/clients?${query}`)).expect(400);
      },
    );
  });

  describe("static routes are not captured by :id", () => {
    it("GET /clients/leads lists leads", async () => {
      const res = await asTrainer(api().get("/clients/leads")).expect(200);

      expect(res.body).toEqual([]);
      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
        userId: TRAINER,
        status: "LEAD",
        deletedAt: null,
      });
      expect(prisma.client.findFirst).not.toHaveBeenCalled();
    });

    it("GET /clients/export/csv downloads a CSV", async () => {
      prisma.client.findMany.mockResolvedValue([clientRow()]);

      const res = await asTrainer(api().get("/clients/export/csv")).expect(200);

      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toBe(
        'attachment; filename="clients.csv"',
      );
      expect(res.text).toContain('"Maria Santos"');
    });
  });

  describe("GET /clients/:id", () => {
    it("answers the detail", async () => {
      prisma.client.findFirst.mockResolvedValue(clientRow({ payments: [] }));

      const res = await asTrainer(api().get(`/clients/${CLIENT_ID}`)).expect(
        200,
      );

      expect(res.body).toMatchObject({ id: CLIENT_ID, payments: [] });
    });

    it("answers 404 for a missing or soft-deleted client", async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await asTrainer(api().get(`/clients/${CLIENT_ID}`)).expect(404);
    });

    it("answers 403 for another trainer's client", async () => {
      prisma.client.findFirst.mockResolvedValue(
        clientRow({ userId: OTHER, payments: [] }),
      );

      await asTrainer(api().get(`/clients/${CLIENT_ID}`)).expect(403);
    });
  });

  describe("writes on a soft-deleted client answer 404 and write nothing", () => {
    beforeEach(() => prisma.client.findFirst.mockResolvedValue(null));

    it.each([
      ["patch", "", { name: "x" }],
      ["patch", "/status", { status: "PAUSED" }],
      ["patch", "/convert", {}],
      ["post", "/avatar-upload-url", { contentType: "image/png" }],
      ["delete", "", undefined],
      [
        "post",
        "/payments",
        { amount: 1, method: "PIX", periodEnd: "2026-11-01T00:00:00.000Z" },
      ],
    ] as const)("%s /clients/:id%s", async (method, suffix, body) => {
      await asTrainer(api()[method](`/clients/${CLIENT_ID}${suffix}`))
        .send(body)
        .expect(404);

      expect(prisma.client.update).not.toHaveBeenCalled();
      expect(prisma.client.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /clients/:id", () => {
    it("writes only the sent field (no default status / modality)", async () => {
      await asTrainer(api().patch(`/clients/${CLIENT_ID}`))
        .send({ name: "Novo" })
        .expect(200);

      const { where, data } = prisma.client.update.mock.calls[0][0];
      expect(where).toEqual({
        id: CLIENT_ID,
        userId: TRAINER,
        deletedAt: null,
      });
      expect(JSON.parse(JSON.stringify(data))).toEqual({ name: "Novo" });
    });

    it("answers 409 when the e-mail is held by another row of the trainer", async () => {
      prisma.client.findFirst
        .mockResolvedValueOnce(clientRow())
        .mockResolvedValueOnce({ id: "other" });

      await asTrainer(api().patch(`/clients/${CLIENT_ID}`))
        .send({ email: "taken@example.com" })
        .expect(409);
      expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it("answers 403 for another trainer's client", async () => {
      prisma.client.findFirst.mockResolvedValue(clientRow({ userId: OTHER }));

      await asTrainer(api().patch(`/clients/${CLIENT_ID}`))
        .send({ name: "x" })
        .expect(403);
    });
  });

  it("PATCH /clients/:id/status accepts a synonym and rejects garbage", async () => {
    await asTrainer(api().patch(`/clients/${CLIENT_ID}/status`))
      .send({ status: "pausada" })
      .expect(200);
    expect(prisma.client.update.mock.calls[0][0].data).toEqual({
      status: "PAUSED",
    });

    await asTrainer(api().patch(`/clients/${CLIENT_ID}/status`))
      .send({ status: "nope" })
      .expect(400);
  });

  it("PATCH /clients/:id/convert answers 400 for a plan of another trainer", async () => {
    prisma.plan.findFirst.mockResolvedValue(null);

    await asTrainer(api().patch(`/clients/${CLIENT_ID}/convert`))
      .send({ planId: PLAN_ID })
      .expect(400);
    expect(prisma.client.update).not.toHaveBeenCalled();
  });

  it("DELETE /clients/:id answers 204 with an empty body", async () => {
    prisma.client.updateMany.mockResolvedValue({ count: 1 });

    const res = await asTrainer(api().delete(`/clients/${CLIENT_ID}`)).expect(
      204,
    );

    expect(res.text).toBe("");
    expect(prisma.client.updateMany.mock.calls[0][0].data).toMatchObject({
      subscriptionStatus: "CANCELED",
      deletedAt: expect.any(Date),
    });
  });

  describe("POST /clients/:id/payments", () => {
    const body = {
      amount: 150,
      method: "PIX",
      periodEnd: "2026-11-03T00:00:00.000Z",
    };

    it("answers 201 with message, payment and client", async () => {
      prisma.payment.create.mockResolvedValue({
        id: "pay-1",
        clientId: CLIENT_ID,
        userId: TRAINER,
        provider: "MANUAL",
        status: "PAID",
        amount: 150,
        method: "PIX",
        externalId: null,
        date: NOW,
        periodEnd: new Date(body.periodEnd),
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      });

      const res = await asTrainer(api().post(`/clients/${CLIENT_ID}/payments`))
        .send(body)
        .expect(201);

      expect(res.body.payment).toMatchObject({ id: "pay-1", status: "PAID" });
      expect(res.body.client.id).toBe(CLIENT_ID);
      expect(res.body.message).toEqual(expect.any(String));
    });

    it.each([
      [{ amount: undefined }],
      [{ method: "MANUAL_PIX" }],
      [{ periodEnd: "soon" }],
      [{ paymentType: "MANUAL_PIX" }],
    ])("answers 400 for %p", async (extra) => {
      await asTrainer(api().post(`/clients/${CLIENT_ID}/payments`))
        .send({ ...body, ...extra })
        .expect(400);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe("public routes", () => {
    const lead = {
      name: "Carlos",
      email: "Carlos@Example.com",
      phone: "53999001122",
      interest: "ambos",
    };

    it("POST /public/:slug/leads answers 201 { id } only", async () => {
      const res = await api().post("/public/vivi/leads").send(lead).expect(201);

      expect(res.body).toEqual({ id: CLIENT_ID });
      expect(users.requireBySlug).toHaveBeenCalledWith("vivi");
      expect(prisma.client.create.mock.calls[0][0].data).toMatchObject({
        email: "carlos@example.com",
        status: "LEAD",
        modality: "HYBRID",
        userId: TRAINER,
      });
      expect(anamnesis.requestAnamnesis).not.toHaveBeenCalled();
    });

    it("POST /public/:slug/leads answers 404 for an unknown slug", async () => {
      users.requireBySlug.mockRejectedValue(new NotFoundException());

      await api().post("/public/nobody/leads").send(lead).expect(404);
      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it("POST /public/:slug/leads answers 409 for a live client's e-mail", async () => {
      prisma.client.create.mockRejectedValue({ code: "P2002" });

      await api().post("/public/vivi/leads").send(lead).expect(409);
      expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it.each([[{ interest: "x" }], [{ status: "ACTIVE" }], [{ userId: OTHER }]])(
      "POST /public/:slug/leads answers 400 for %p",
      async (extra) => {
        await api()
          .post("/public/vivi/leads")
          .send({ ...lead, ...extra })
          .expect(400);
      },
    );

    it("GET /public/:slug/plans answers the grouped plans, 404 for an unknown slug", async () => {
      const res = await api().get("/public/vivi/plans").expect(200);
      expect(res.body).toEqual({ presencial: [], consultoria: [] });

      users.requireBySlug.mockRejectedValue(new NotFoundException());
      await api().get("/public/nobody/plans").expect(404);
    });
  });

  describe("plans", () => {
    const body = {
      type: "PRESENCIAL",
      name: "Básico",
      sessionsPerWeek: 3,
      price: 200,
    };

    it.each([
      [{ features: ["not_a_feature"] }],
      [{ featureIds: [PLAN_ID] }],
      [{ sessionsPerWeek: 9 }],
    ])("POST /plans answers 400 for %p", async (extra) => {
      await asTrainer(api().post("/plans"))
        .send({ ...body, ...extra })
        .expect(400);
      expect(prisma.plan.create).not.toHaveBeenCalled();
    });

    it("PATCH /plans/:id validates the body (it did not before)", async () => {
      await asTrainer(api().patch(`/plans/${PLAN_ID}`))
        .send({ userId: OTHER })
        .expect(400);
      await asTrainer(api().patch(`/plans/${PLAN_ID}`))
        .send({ price: -1 })
        .expect(400);
      expect(prisma.plan.update).not.toHaveBeenCalled();
    });

    it("GET /plan-features answers the catalogue", async () => {
      const res = await asTrainer(api().get("/plan-features")).expect(200);

      expect(res.body).toHaveLength(5);
      expect(res.body[0]).toEqual({
        key: "ai_whatsapp_bot",
        name: expect.any(String),
        description: expect.any(String),
      });
    });
  });
});
