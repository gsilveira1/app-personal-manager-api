import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { configureApp } from "../../src/app.setup";
import { AppModule } from "../../src/modules/app.module";
import { MailerService } from "../../src/modules/mailer/mailer.service";
import { WhatsAppService } from "../../src/modules/messaging/whatsapp.service";
import { PrismaService } from "../../src/modules/prisma/prisma.service";

/**
 * Stand-in for the Evolution API client: records what would have been sent and
 * never opens a connection. Every other provider call fails loudly so a test
 * cannot reach the real provider by accident.
 */
export class WhatsAppStub {
  readonly sent: Array<{ instanceName: string; phone: string; text: string }> =
    [];

  async sendTextMessage(instanceName: string, phone: string, text: string) {
    this.sent.push({ instanceName, phone, text });
    return { messageId: `e2e-${this.sent.length}` };
  }

  cleanPhoneNumber(phone: string): string {
    return phone.replace(/\D/g, "");
  }

  private refuse(method: string): never {
    throw new Error(`WhatsAppStub.${method} is not available in e2e`);
  }
  ensureInstance = () => this.refuse("ensureInstance");
  fetchQrCode = () => this.refuse("fetchQrCode");
  checkInstanceStatus = () => this.refuse("checkInstanceStatus");
  disconnectInstance = () => this.refuse("disconnectInstance");
}

/** Records e-mails instead of sending them. */
export class MailerStub {
  readonly sent: Array<{ to: string; token?: string }> = [];

  async sendMail(options: { to: string }) {
    this.sent.push({ to: options.to });
    return { messageId: `e2e-mail-${this.sent.length}` };
  }

  async sendPasswordResetEmail(email: string, _name: string, token: string) {
    this.sent.push({ to: email, token });
    return { messageId: `e2e-mail-${this.sent.length}` };
  }
}

export interface E2eApp {
  app: INestApplication;
  prisma: PrismaService;
  whatsapp: WhatsAppStub;
  mailer: MailerStub;
  http: () => ReturnType<typeof request>;
}

/**
 * Boots the whole AppModule against the throwaway PostgreSQL and Redis (see
 * test/setup-env.ts) with the HTTP pipeline of main.ts. WhatsApp and e-mail are
 * stubbed: nothing leaves the process.
 */
export async function createE2eApp(): Promise<E2eApp> {
  const whatsapp = new WhatsAppStub();
  const mailer = new MailerStub();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WhatsAppService)
    .useValue(whatsapp)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    prisma: moduleRef.get(PrismaService),
    whatsapp,
    mailer,
    http: () => request(app.getHttpServer()),
  };
}

export interface Trainer {
  id: string;
  email: string;
  slug: string;
  token: string;
  auth: { Authorization: string };
}

let sequence = 0;

/** A string that is unique across runs and files (letters and digits only). */
export function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid}x${sequence}`;
}

/** Signs up a fresh trainer; every suite works on its own account. */
export async function signUpTrainer(
  e2e: E2eApp,
  label: string,
): Promise<Trainer> {
  const email = `${unique(label)}@e2e.test`;
  const res = await e2e
    .http()
    .post("/api/auth/signup")
    .send({ name: `E2E ${label}`, email, password: "TestPass123!" })
    .expect(201);
  return {
    id: res.body.user.id,
    email,
    slug: res.body.user.slug,
    token: res.body.access_token,
    auth: { Authorization: `Bearer ${res.body.access_token}` },
  };
}

/**
 * Creates a client through the API. Notifications are off by default so the
 * welcome anamnesis does not put a job on the queue behind the test's back.
 */
export async function createClient(
  e2e: E2eApp,
  trainer: Trainer,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; email: string; phone: string }> {
  const res = await e2e
    .http()
    .post("/api/clients")
    .set(trainer.auth)
    .send({
      name: "Aluna E2E",
      email: `${unique("aluna")}@e2e.test`,
      phone: "+5553999990000",
      notificationEnabled: false,
      ...overrides,
    })
    .expect(201);
  return res.body;
}

/** Hard-deletes the accounts a suite created; the schema cascades to everything they own. */
export async function removeTrainers(
  e2e: E2eApp,
  trainers: Array<Trainer | undefined>,
): Promise<void> {
  const ids = trainers.flatMap((trainer) => (trainer ? [trainer.id] : []));
  await e2e.prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Polls until `probe` returns a value, or fails after `timeoutMs`. */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  description: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
