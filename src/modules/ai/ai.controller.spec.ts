import { INestApplication, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { USER_DIRECTORY } from "../../common/ports";
import {
  bearerFor,
  createHttpTestApp,
} from "../workouts/testing/http-test-app";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

const mockGenerateContent = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Type: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    NUMBER: "NUMBER",
    ARRAY: "ARRAY",
  },
}));

describe("AiController (JWT guard, contract endpoints 57-58)", () => {
  let app: INestApplication;
  const ai = {
    generateWorkoutPlan: jest.fn(),
    generateWorkoutInsights: jest.fn(),
  };
  const planBody = {
    clientName: "Mariana",
    goal: "Hipertrofia",
    experienceLevel: "Intermediário",
    daysPerWeek: 4,
  };
  const insightsBody = { client: { name: "Mariana" }, archivedPlans: [] };

  beforeAll(async () => {
    app = await createHttpTestApp({
      controllers: [AiController],
      providers: [{ provide: AiService, useValue: ai }],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  it.each([
    ["/ai/workout-plan", planBody],
    ["/ai/workout-insights", insightsBody],
  ])(
    "POST %s answers 401 without a token and never reaches the service",
    async (path, body) => {
      await request(app.getHttpServer()).post(path).send(body).expect(401);

      expect(ai.generateWorkoutPlan).not.toHaveBeenCalled();
      expect(ai.generateWorkoutInsights).not.toHaveBeenCalled();
    },
  );

  it("POST /ai/workout-plan answers 401 for a token with a bad signature", async () => {
    await request(app.getHttpServer())
      .post("/ai/workout-plan")
      .set("Authorization", "Bearer not.a.jwt")
      .send(planBody)
      .expect(401);
  });

  it("POST /ai/workout-plan reaches the service with a valid token", async () => {
    ai.generateWorkoutPlan.mockResolvedValue({ title: "Plano" });

    await request(app.getHttpServer())
      .post("/ai/workout-plan")
      .set("Authorization", bearerFor("user-1"))
      .send(planBody)
      .expect(201, { title: "Plano" });

    expect(ai.generateWorkoutPlan).toHaveBeenCalledWith("user-1", planBody);
  });

  it("POST /ai/workout-insights reaches the service with a valid token", async () => {
    ai.generateWorkoutInsights.mockResolvedValue({ insights: [] });

    await request(app.getHttpServer())
      .post("/ai/workout-insights")
      .set("Authorization", bearerFor("user-1"))
      .send(insightsBody)
      .expect(201);

    expect(ai.generateWorkoutInsights).toHaveBeenCalledWith(
      "user-1",
      insightsBody,
    );
  });

  describe("validation (review M5)", () => {
    it("POST /ai/workout-plan answers 400 for a 20k-character goal", async () => {
      await request(app.getHttpServer())
        .post("/ai/workout-plan")
        .set("Authorization", bearerFor("user-1"))
        .send({ ...planBody, goal: "a".repeat(20_000) })
        .expect(400);

      expect(ai.generateWorkoutPlan).not.toHaveBeenCalled();
    });

    it("POST /ai/workout-insights answers 400 for 51 archived plans", async () => {
      await request(app.getHttpServer())
        .post("/ai/workout-insights")
        .set("Authorization", bearerFor("user-1"))
        .send({
          ...insightsBody,
          archivedPlans: Array.from({ length: 51 }, () => ({ title: "T" })),
        })
        .expect(400);

      expect(ai.generateWorkoutInsights).not.toHaveBeenCalled();
    });

    it("POST /ai/workout-insights passes only the fields the prompt uses", async () => {
      ai.generateWorkoutInsights.mockResolvedValue({ insights: [] });

      await request(app.getHttpServer())
        .post("/ai/workout-insights")
        .set("Authorization", bearerFor("user-1"))
        .send({
          client: { id: "c-1", name: "Mariana", email: "m@example.com" },
          archivedPlans: [{ id: "w-1", title: "Treino A", exercises: [] }],
        })
        .expect(201);

      const dto = ai.generateWorkoutInsights.mock.calls[0][1];
      expect(JSON.parse(JSON.stringify(dto))).toEqual({
        client: { name: "Mariana" },
        archivedPlans: [{ title: "Treino A" }],
      });
    });
  });
});

describe("AiController with the real service (review M5: provider errors)", () => {
  let app: INestApplication;
  let logError: jest.SpyInstance;

  beforeAll(async () => {
    logError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    app = await createHttpTestApp({
      controllers: [AiController],
      providers: [
        AiService,
        {
          provide: USER_DIRECTORY,
          useValue: { getSettings: async () => ({ aiInstructions: "" }) },
        },
        { provide: ConfigService, useValue: { get: () => "test-key" } },
      ],
    });
  });
  afterAll(async () => {
    logError.mockRestore();
    await app.close();
  });

  it.each([
    [
      "/ai/workout-plan",
      {
        clientName: "Mariana",
        goal: "Hipertrofia",
        experienceLevel: "Intermediário",
        daysPerWeek: 4,
      },
    ],
    [
      "/ai/workout-insights",
      { client: { name: "Mariana" }, archivedPlans: [] },
    ],
  ])(
    "POST %s answers 502 without the provider's error text",
    async (path, body) => {
      mockGenerateContent.mockRejectedValueOnce(
        Object.assign(new Error("quota exceeded for key AIzaSy-LEAKED"), {
          status: 429,
        }),
      );

      const res = await request(app.getHttpServer())
        .post(path)
        .set("Authorization", bearerFor("user-1"))
        .send(body)
        .expect(502);

      expect(JSON.stringify(res.body)).not.toContain("AIzaSy-LEAKED");
      expect(JSON.stringify(res.body)).not.toContain("quota");
      expect(res.body.message).toBe("AI provider request failed");
    },
  );
});
