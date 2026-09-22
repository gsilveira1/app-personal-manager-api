/**
 * Integration & E2E tests for Messaging Queue, WhatsApp dispatching, and Link Resends.
 *
 * Pre-requisites: DATABASE_URL env var pointing to an accessible PostgreSQL DB.
 * Run with: npm run test:e2e -- --testPathPattern=messaging-queue
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/modules/app.module";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { WhatsAppService } from "../src/modules/messaging/whatsapp.service";

describe("Messaging Queue & WhatsApp Dispatch API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsappService: WhatsAppService;
  let jwtToken: string;
  let userId: string;
  let tenantId: string;
  let clientId: string;

  const TEST_USER = {
    name: "E2E Trainer",
    email: `e2e-trainer-${Date.now()}@viviops.test`,
    password: "Password123!",
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix("api");
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    whatsappService = moduleRef.get<WhatsAppService>(WhatsAppService);

    // Mock WhatsApp service HTTP dispatch to simulate Evolution API
    jest.spyOn(whatsappService, "sendTextMessage").mockImplementation(
      async (instanceName, phone, text) => {
        if (instanceName === "invalid-instance") {
          return { success: false, error: "Evolution API HTTP 404: Instance not found" };
        }
        return { success: true, messageId: `mock-e2e-msg-${Date.now()}` };
      },
    );

    // 1. Create trainer via signup
    const signupRes = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send(TEST_USER)
      .expect(201);

    userId = signupRes.body.id;

    // 2. Login to get JWT
    const loginRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password })
      .expect(200);

    jwtToken = loginRes.body.access_token;

    // 3. Create tenant associated with user
    const tenant = await prisma.tenant.create({
      data: {
        name: "Academia E2E",
        slug: `academia-e2e-${Date.now()}`,
        whatsappInstanceName: "tenant-e2e-instance",
        whatsappStatus: "CONNECTED",
      },
    });
    tenantId = tenant.id;

    await prisma.user.update({
      where: { id: userId },
      data: { tenantId },
    });

    // 4. Create test student (client)
    const client = await prisma.client.create({
      data: {
        name: "Aluno E2E",
        email: `aluno-${Date.now()}@test.com`,
        phone: "+55 (11) 99887-7665",
        status: "ACTIVE",
        userId,
        tenantId,
      },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.notificationLog.deleteMany({ where: { tenantId } });
      await prisma.client.deleteMany({ where: { tenantId } });
    }
    if (userId) {
      await prisma.plan.deleteMany({ where: { userId } });
      await prisma.userSetting.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  const authHeader = () => ({ Authorization: `Bearer ${jwtToken}` });

  describe("POST /api/students/:id/resend-link", () => {
    it("should successfully trigger and dispatch workout sheet link via WhatsApp", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/students/${clientId}/resend-link`)
        .set(authHeader())
        .send({ type: "WORKOUT_SHEET" })
        .expect(200);

      expect(res.body).toHaveProperty("channel");
      expect(res.body).toHaveProperty("link");
      expect(res.body.link).toContain("token=");
    });

    it("should reject invalid resend type with 400", async () => {
      await request(app.getHttpServer())
        .post(`/api/students/${clientId}/resend-link`)
        .set(authHeader())
        .send({ type: "INVALID_TYPE" })
        .expect(400);
    });
  });

  describe("GET /api/messaging/queue", () => {
    it("should return message queue items and aggregate summary", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/messaging/queue")
        .set(authHeader())
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("summary");
      expect(res.body.summary).toHaveProperty("totalQueued");
      expect(res.body.summary).toHaveProperty("totalSent");
    });

    it("should filter queue by status", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/messaging/queue?status=SENT")
        .set(authHeader())
        .expect(200);

      expect(res.body).toHaveProperty("items");
    });
  });

  describe("POST /api/messaging/queue/:id/retry", () => {
    it("should retry delivery of a message and update its status", async () => {
      // Create a test failed log
      const failedLog = await prisma.notificationLog.create({
        data: {
          tenantId,
          recipientPhone: "+5511999998888",
          templateType: "WELCOME_ANAMNESIS",
          status: "FAILED",
          channel: "WHATSAPP",
          error: "Simulated prior failure",
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/messaging/queue/${failedLog.id}/retry`)
        .set(authHeader())
        .expect(200);

      expect(res.body.message).toContain("reenviada com sucesso");
      expect(res.body.notification.status).toBe("SENT");
    });
  });

  describe("DELETE /api/messaging/queue/:id", () => {
    it("should cancel a queued notification", async () => {
      const queuedLog = await prisma.notificationLog.create({
        data: {
          tenantId,
          recipientPhone: "+5511999998888",
          templateType: "EXPIRATION_ALERT",
          status: "QUEUED",
          channel: "WHATSAPP",
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/messaging/queue/${queuedLog.id}`)
        .set(authHeader())
        .expect(200);

      expect(res.body.message).toContain("cancelada com sucesso");
      expect(res.body.notification.status).toBe("CANCELLED");
    });
  });

  describe("POST /api/messaging/queue/process", () => {
    it("should process pending queued messages", async () => {
      await prisma.notificationLog.create({
        data: {
          tenantId,
          recipientPhone: "+5511988887777",
          templateType: "WORKOUT_LINK",
          status: "QUEUED",
          channel: "WHATSAPP",
        },
      });

      const res = await request(app.getHttpServer())
        .post("/api/messaging/queue/process")
        .set(authHeader())
        .expect(200);

      expect(res.body).toHaveProperty("processedCount");
      expect(res.body).toHaveProperty("successCount");
    });
  });
});
