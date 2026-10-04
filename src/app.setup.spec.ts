import { Body, Controller, INestApplication, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import {
  bodyLimitFor,
  configureApp,
  DEFAULT_BODY_LIMIT,
  DEV_DATA_URL_BODY_LIMIT,
  isOriginAllowed,
  resolveAllowedOrigins,
  STRUCTURED_BODY_LIMIT,
} from "./app.setup";

@Controller()
class EchoController {
  @Post(["public/:slug/leads", "workout-templates", "clients/:id"])
  echo(@Body() body: Record<string, unknown>) {
    return { keys: Object.keys(body).length };
  }
}

const KB = 1024;
const bodyOf = (bytes: number) => ({ padding: "a".repeat(bytes) });

describe("bodyLimitFor (review M2)", () => {
  const prod = { NODE_ENV: "production" };
  const dev = { NODE_ENV: "development" };

  it.each([
    ["POST", "/api/public/vivi/leads"],
    ["POST", "/api/anamnesis/submit"],
    ["POST", "/api/student/sessions"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/clients"],
    ["POST", "/api/clients/c-1/avatar-upload-url"],
    ["POST", "/api/users/avatar-upload-url"],
    ["GET", "/api/workout-templates"],
    ["POST", "/somewhere/else"],
  ])("%s %s gets the default limit", (method, path) => {
    expect(bodyLimitFor(method, path, prod)).toBe(DEFAULT_BODY_LIMIT);
    expect(bodyLimitFor(method, path, dev)).toBe(DEFAULT_BODY_LIMIT);
  });

  it.each([
    ["POST", "/api/clients/c-1/workout-sheets"],
    ["PATCH", "/api/workout-sheets/s-1"],
    ["POST", "/api/workout-templates"],
    ["POST", "/api/workout-templates/"],
  ])("%s %s gets the structured-document limit", (method, path) => {
    expect(bodyLimitFor(method, path, prod)).toBe(STRUCTURED_BODY_LIMIT);
  });

  it.each([
    ["PATCH", "/api/clients/c-1"],
    ["PATCH", "/api/users/profile"],
    ["POST", "/api/ai/workout-plan"],
    ["POST", "/api/ai/workout-insights"],
  ])("%s %s takes a base64 avatar outside production only", (method, path) => {
    expect(bodyLimitFor(method, path, dev)).toBe(DEV_DATA_URL_BODY_LIMIT);
    expect(bodyLimitFor(method, path, {})).toBe(DEV_DATA_URL_BODY_LIMIT);
    expect(bodyLimitFor(method, path, prod)).not.toBe(DEV_DATA_URL_BODY_LIMIT);
  });

  it("AI routes keep the structured limit in production", () => {
    expect(bodyLimitFor("POST", "/api/ai/workout-insights", prod)).toBe(
      STRUCTURED_BODY_LIMIT,
    );
    expect(bodyLimitFor("PATCH", "/api/clients/c-1", prod)).toBe(
      DEFAULT_BODY_LIMIT,
    );
  });

  it("states the numbers", () => {
    expect(DEFAULT_BODY_LIMIT).toBe("100kb");
    expect(STRUCTURED_BODY_LIMIT).toBe("1mb");
    expect(DEV_DATA_URL_BODY_LIMIT).toBe("8mb");
  });
});

describe("CORS allow-list (review L9)", () => {
  it("production: CORS_ALLOWED_ORIGINS plus FRONTEND_URL and APP_CLIENT_URL, nothing else", () => {
    const env = {
      NODE_ENV: "production",
      CORS_ALLOWED_ORIGINS:
        "https://site.example.com, https://www.example.com/",
      FRONTEND_URL: "https://app.example.com/some/path",
      APP_CLIENT_URL: "https://legacy.example.com",
    };

    expect(resolveAllowedOrigins(env)).toEqual([
      "https://site.example.com",
      "https://www.example.com",
      "https://app.example.com",
      "https://legacy.example.com",
    ]);
    expect(isOriginAllowed("https://app.example.com", env)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", env)).toBe(false);
    expect(isOriginAllowed("http://localhost:5173", env)).toBe(false);
    expect(isOriginAllowed("https://app.example.com.evil.io", env)).toBe(false);
  });

  it("production with nothing configured allows no cross-origin caller", () => {
    const env = { NODE_ENV: "production" };

    expect(resolveAllowedOrigins(env)).toEqual([]);
    expect(isOriginAllowed("http://localhost:5173", env)).toBe(false);
  });

  it.each([
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:4321",
    "http://localhost",
  ])("outside production %s (a loopback dev server) is allowed", (origin) => {
    expect(isOriginAllowed(origin, { NODE_ENV: "development" })).toBe(true);
    expect(isOriginAllowed(origin, {})).toBe(true);
  });

  it.each([
    "https://evil.example.com",
    "http://localhost.evil.io",
    "http://localhost:5173.evil.io",
    "null",
  ])("outside production %s is still refused", (origin) => {
    expect(isOriginAllowed(origin, { NODE_ENV: "development" })).toBe(false);
  });

  it("rejects a CORS_ALLOWED_ORIGINS entry that is not an origin", () => {
    expect(() => resolveAllowedOrigins({ CORS_ALLOWED_ORIGINS: "*" })).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });
});

describe("configureApp over HTTP", () => {
  let app: INestApplication;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://app.example.com";
    delete process.env.APP_CLIENT_URL;
    delete process.env.CORS_ALLOWED_ORIGINS;
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    process.env = { ...savedEnv };
    await app.close();
  });

  it("answers 413 for a body above 100 kb on the public lead route", async () => {
    await request(app.getHttpServer())
      .post("/api/public/vivi/leads")
      .send(bodyOf(101 * KB))
      .expect(413);
  });

  it("parses a body just under 100 kb", async () => {
    await request(app.getHttpServer())
      .post("/api/public/vivi/leads")
      .send(bodyOf(90 * KB))
      .expect(201);
  });

  it("takes 500 kb on a workout-structure route and refuses 1.1 MB", async () => {
    await request(app.getHttpServer())
      .post("/api/workout-templates")
      .send(bodyOf(500 * KB))
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/workout-templates")
      .send(bodyOf(1100 * KB))
      .expect(413);
  });

  it("production: PATCH-style avatar routes keep the default limit", async () => {
    await request(app.getHttpServer())
      .post("/api/clients/c-1")
      .send(bodyOf(101 * KB))
      .expect(413);
  });

  it("answers 413 for an over-long urlencoded body", async () => {
    await request(app.getHttpServer())
      .post("/api/public/vivi/leads")
      .type("form")
      .send(`padding=${"a".repeat(101 * KB)}`)
      .expect(413);
  });

  it("an unlisted origin gets no Access-Control-Allow-Origin", async () => {
    const res = await request(app.getHttpServer())
      .options("/api/public/vivi/leads")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("an unlisted origin gets no CORS header on the actual request either", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/workout-templates")
      .set("Origin", "https://evil.example.com")
      .send({});

    expect(res.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("the configured frontend origin is echoed back", async () => {
    const res = await request(app.getHttpServer())
      .options("/api/public/vivi/leads")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.example.com",
    );
    expect(res.headers["vary"]).toMatch(/Origin/);
  });
});
