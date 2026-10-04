import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ExercisesController } from "./exercises/exercises.controller";
import { ExercisesService } from "./exercises/exercises.service";
import { ClientActivityService } from "./portal/client-activity.service";
import { MagicLinkService } from "./portal/magic-link.service";
import {
  ClientPortalController,
  StudentPortalController,
} from "./portal/portal.controller";
import { StudentPortalService } from "./portal/student-portal.service";
import {
  ClientWorkoutSheetsController,
  WorkoutSheetsController,
  WorkoutTemplatesController,
} from "./sheets/workout-sheets.controller";
import { WorkoutSheetsService } from "./sheets/workout-sheets.service";
import { SHEET_INPUT } from "./testing/fixtures";
import { bearerFor, createHttpTestApp } from "./testing/http-test-app";

describe("workouts HTTP surface (contract 6.3, endpoints 41-56)", () => {
  let app: INestApplication;
  const auth = bearerFor("user-1");

  const exercises = { findAll: jest.fn(), create: jest.fn() };
  const sheets = {
    createForClient: jest.fn(),
    findByClient: jest.fn(),
    findExpiring: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findTemplates: jest.fn(),
    createTemplate: jest.fn(),
    saveAsTemplate: jest.fn(),
  };
  const portal = { getActiveSheet: jest.fn(), recordSession: jest.fn() };
  const magicLinks = { generate: jest.fn(), send: jest.fn() };
  const activity = { getHeatmap: jest.fn() };

  beforeAll(async () => {
    app = await createHttpTestApp({
      controllers: [
        ExercisesController,
        ClientWorkoutSheetsController,
        WorkoutSheetsController,
        WorkoutTemplatesController,
        StudentPortalController,
        ClientPortalController,
      ],
      providers: [
        { provide: ExercisesService, useValue: exercises },
        { provide: WorkoutSheetsService, useValue: sheets },
        { provide: StudentPortalService, useValue: portal },
        { provide: MagicLinkService, useValue: magicLinks },
        { provide: ClientActivityService, useValue: activity },
      ],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  const http = () => request(app.getHttpServer());

  describe("JWT routes answer 401 without a token", () => {
    it.each([
      ["get", "/exercises"],
      ["post", "/exercises"],
      ["post", "/clients/c1/workout-sheets"],
      ["get", "/clients/c1/workout-sheets"],
      ["get", "/workout-sheets/expiring"],
      ["get", "/workout-sheets/s1"],
      ["patch", "/workout-sheets/s1"],
      ["delete", "/workout-sheets/s1"],
      ["get", "/workout-templates"],
      ["post", "/workout-templates"],
      ["post", "/workout-templates/from-sheet/s1"],
      ["post", "/clients/c1/magic-link"],
      ["post", "/clients/c1/magic-link/send"],
      ["get", "/clients/c1/activity-heatmap"],
    ] as const)("%s %s", async (method, path) => {
      await http()[method](path).expect(401);
    });
  });

  describe("exercises", () => {
    it("GET /exercises passes the caller and the filters", async () => {
      exercises.findAll.mockResolvedValue([]);

      await http()
        .get("/exercises?search=supino&bodyPart=chest")
        .set("Authorization", auth)
        .expect(200, []);

      expect(exercises.findAll).toHaveBeenCalledWith("user-1", {
        search: "supino",
        bodyPart: "chest",
      });
    });

    it("POST /exercises answers 201, and 400 for an unknown property (no userId injection)", async () => {
      exercises.create.mockResolvedValue({ id: "ex-1" });
      const body = {
        name: "Prancha",
        bodyPart: "waist",
        equipment: "bodyweight",
      };

      await http()
        .post("/exercises")
        .set("Authorization", auth)
        .send(body)
        .expect(201);
      await http()
        .post("/exercises")
        .set("Authorization", auth)
        .send({ ...body, userId: null })
        .expect(400);

      expect(exercises.create).toHaveBeenCalledTimes(1);
      expect(exercises.create).toHaveBeenCalledWith("user-1", body);
    });
  });

  describe("sheets and templates", () => {
    it("POST /clients/:id/workout-sheets answers 201", async () => {
      sheets.createForClient.mockResolvedValue({ id: "sheet-1" });

      await http()
        .post("/clients/client-1/workout-sheets")
        .set("Authorization", auth)
        .send({ name: "Ficha A", ...SHEET_INPUT })
        .expect(201, { id: "sheet-1" });

      expect(sheets.createForClient).toHaveBeenCalledWith(
        "user-1",
        "client-1",
        expect.objectContaining({ name: "Ficha A" }),
      );
    });

    it.each([
      ["a missing name", { ...SHEET_INPUT }],
      ["a missing workouts list", { name: "Ficha" }],
      [
        "an unknown block type",
        {
          name: "Ficha",
          workouts: [
            {
              letter: "A",
              name: "A",
              blocks: [{ type: "GIANT", exercises: [] }],
            },
          ],
        },
      ],
      [
        "a segment id outside the allowed alphabet",
        {
          name: "Ficha",
          workouts: [{ id: "a b", letter: "A", name: "A", blocks: [] }],
        },
      ],
      ["an unknown property", { name: "Ficha", ...SHEET_INPUT, active: false }],
    ])(
      "POST /clients/:id/workout-sheets answers 400 for %s",
      async (_case, body) => {
        await http()
          .post("/clients/client-1/workout-sheets")
          .set("Authorization", auth)
          .send(body)
          .expect(400);
        expect(sheets.createForClient).not.toHaveBeenCalled();
      },
    );

    it("GET /workout-sheets/expiring is not swallowed by /workout-sheets/:id", async () => {
      sheets.findExpiring.mockResolvedValue([]);

      await http()
        .get("/workout-sheets/expiring")
        .set("Authorization", auth)
        .expect(200, []);

      expect(sheets.findExpiring).toHaveBeenCalledWith("user-1");
      expect(sheets.findOne).not.toHaveBeenCalled();
    });

    it("PATCH /workout-sheets/:id accepts expiresAt null and rejects a null name", async () => {
      sheets.update.mockResolvedValue({ id: "sheet-1" });

      await http()
        .patch("/workout-sheets/sheet-1")
        .set("Authorization", auth)
        .send({ expiresAt: null, tags: ["a"] })
        .expect(200);
      await http()
        .patch("/workout-sheets/sheet-1")
        .set("Authorization", auth)
        .send({ name: null })
        .expect(400);

      expect(sheets.update).toHaveBeenCalledTimes(1);
      expect(sheets.update).toHaveBeenCalledWith("user-1", "sheet-1", {
        expiresAt: null,
        tags: ["a"],
      });
    });

    it("DELETE /workout-sheets/:id answers 200 with a message", async () => {
      sheets.remove.mockResolvedValue({ message: "ok" });

      await http()
        .delete("/workout-sheets/sheet-1")
        .set("Authorization", auth)
        .expect(200, { message: "ok" });
    });

    it("POST /workout-templates and /from-sheet/:sheetId answer 201", async () => {
      sheets.createTemplate.mockResolvedValue({ id: "t-1" });
      sheets.saveAsTemplate.mockResolvedValue({ id: "t-2" });

      await http()
        .post("/workout-templates")
        .set("Authorization", auth)
        .send({ name: "Modelo", tags: ["peito"], ...SHEET_INPUT })
        .expect(201);
      await http()
        .post("/workout-templates/from-sheet/sheet-1")
        .set("Authorization", auth)
        .send({ name: "Modelo", description: "Base" })
        .expect(201);

      expect(sheets.saveAsTemplate).toHaveBeenCalledWith("user-1", "sheet-1", {
        name: "Modelo",
        description: "Base",
      });
    });
  });

  describe("trainer-side portal routes", () => {
    it("POST /clients/:id/magic-link answers 201, /send answers 200", async () => {
      magicLinks.generate.mockResolvedValue({ token: "t", url: "u" });
      magicLinks.send.mockResolvedValue({ status: "QUEUED" });

      await http()
        .post("/clients/client-1/magic-link")
        .set("Authorization", auth)
        .expect(201);
      await http()
        .post("/clients/client-1/magic-link/send")
        .set("Authorization", auth)
        .expect(200, { status: "QUEUED" });

      expect(magicLinks.send).toHaveBeenCalledWith("user-1", "client-1");
    });

    it("GET /clients/:id/activity-heatmap converts days and rejects garbage", async () => {
      activity.getHeatmap.mockResolvedValue({ days: [] });

      await http()
        .get("/clients/client-1/activity-heatmap?days=7")
        .set("Authorization", auth)
        .expect(200);
      await http()
        .get("/clients/client-1/activity-heatmap")
        .set("Authorization", auth)
        .expect(200);
      await http()
        .get("/clients/client-1/activity-heatmap?days=abc")
        .set("Authorization", auth)
        .expect(400);

      expect(activity.getHeatmap.mock.calls).toEqual([
        ["user-1", "client-1", 7],
        ["user-1", "client-1", undefined],
      ]);
    });
  });

  describe("student routes (magic token)", () => {
    it("GET /student/workout-sheet answers 401 without any token", async () => {
      await http().get("/student/workout-sheet").expect(401);
      expect(portal.getActiveSheet).not.toHaveBeenCalled();
    });

    it("reads the token from ?token= or from the Authorization header (header first)", async () => {
      portal.getActiveSheet.mockResolvedValue({ sheetId: null });

      await http().get("/student/workout-sheet?token=from-query").expect(200);
      await http()
        .get("/student/workout-sheet?token=from-query")
        .set("Authorization", "Bearer from-header")
        .expect(200);

      expect(portal.getActiveSheet.mock.calls).toEqual([
        ["from-query"],
        ["from-header"],
      ]);
    });

    it("POST /student/sessions answers 200 and validates the body", async () => {
      portal.recordSession.mockResolvedValue({ sessionId: "s-1" });
      const body = {
        workoutId: "w-1",
        durationSeconds: 3000,
        loads: [{ workoutExerciseId: "we-1", loadKg: 65, completed: true }],
      };

      await http().post("/student/sessions?token=tok").send(body).expect(200);
      await http()
        .post("/student/sessions?token=tok")
        .send({ ...body, durationSeconds: "soon" })
        .expect(400);
      await http().post("/student/sessions").send(body).expect(401);

      expect(portal.recordSession).toHaveBeenCalledTimes(1);
      expect(portal.recordSession).toHaveBeenCalledWith("tok", body);
    });
  });
});
