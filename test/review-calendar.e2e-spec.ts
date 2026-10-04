/**
 * Security-review regressions of the calendar against a real database:
 * H1 (unbounded RRULE expansion) and L7 (double booking under concurrency).
 */
import { EventType } from "@prisma/client";

import {
  createClient,
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
} from "./support/e2e-app";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ABUSIVE_RULE =
  "FREQ=DAILY;BYHOUR=0,1,2,3;BYMINUTE=0,1,2,3;BYSECOND=0,1,2,3";

describe("Calendar review findings (e2e)", () => {
  let e2e: E2eApp;
  let trainer: Trainer;
  let clientId: string;
  /** Tomorrow 13:00 UTC, whole seconds. */
  const base = new Date(Math.floor((Date.now() + DAY) / DAY) * DAY + 13 * HOUR);
  const at = (days: number, hours = 0) =>
    new Date(base.getTime() + days * DAY + hours * HOUR).toISOString();

  beforeAll(async () => {
    e2e = await createE2eApp();
    trainer = await signUpTrainer(e2e, "reviewcal");
    clientId = (await createClient(e2e, trainer)).id;
  });

  afterAll(async () => {
    await removeTrainers(e2e, [trainer]);
    await e2e.app.close();
  });

  const postSession = (body: Record<string, unknown>) =>
    e2e
      .http()
      .post("/api/sessions")
      .set(trainer.auth)
      .send({
        durationMinutes: 60,
        type: "In-Person",
        category: "Workout",
        clientId,
        ...body,
      });

  const get = (path: string, query: Record<string, string>) =>
    e2e.http().get(path).query(query).set(trainer.auth);

  describe("H1 — recurrence rules cannot exhaust the process", () => {
    it("refuses a rule with a sub-daily BY* part on sessions and blocks (400) and stores nothing", async () => {
      await postSession({ date: at(200), rrule: ABUSIVE_RULE }).expect(400);
      await e2e
        .http()
        .post("/api/availability-blocks")
        .set(trainer.auth)
        .send({
          title: "Abuso",
          dtstart: at(200),
          dtend: at(200, 1),
          rrule: "FREQ=DAILY;BYSECOND=0,1",
        })
        .expect(400);

      expect(
        await e2e.prisma.event.count({ where: { userId: trainer.id } }),
      ).toBe(0);
    });

    it.each([
      ["a 10-year range", "2025-01-01", "2035-01-01"],
      ["absurd years", "0100-01-01", "9999-12-31"],
    ])(
      "answers 400 for %s on both list endpoints",
      async (_label, start, end) => {
        await get("/api/sessions", { start, end }).expect(400);
        await get("/api/availability-blocks", { start, end }).expect(400);
      },
    );

    it("lists a daily series over the longest accepted range (366 days)", async () => {
      const created = await postSession({
        date: at(300),
        rrule: "FREQ=DAILY",
      }).expect(201);

      const res = await get("/api/sessions", {
        start: at(300),
        end: at(666),
      }).expect(200);

      expect(res.body).toHaveLength(367);
      await e2e
        .http()
        .delete(`/api/sessions/${created.body.id}`)
        .set(trainer.auth)
        .expect(204);
    });

    it("leaves an abusive rule that is already stored out of the public slot search, quickly", async () => {
      await e2e.prisma.event.create({
        data: {
          type: EventType.BLOCK,
          title: "Legado",
          userId: trainer.id,
          date: new Date(at(0)),
          durationMinutes: 60,
          rrule: ABUSIVE_RULE,
        },
      });
      const started = Date.now();

      await e2e
        .http()
        .get(`/api/public/${trainer.slug}/availability`)
        .query({ start: at(0).slice(0, 10), end: at(90).slice(0, 10) })
        .expect(200);
      await get("/api/availability-blocks", {
        start: at(0),
        end: at(366),
      }).expect(200, []);

      expect(Date.now() - started).toBeLessThan(5_000);
      await e2e.prisma.event.deleteMany({
        where: { userId: trainer.id, type: EventType.BLOCK },
      });
    });
  });

  describe("L7 — double booking", () => {
    it("lets exactly one of eight concurrent requests for the same slot through", async () => {
      const date = at(700);

      const responses = await Promise.all(
        Array.from({ length: 8 }, () => postSession({ date })),
      );

      expect(responses.map((res) => res.status).sort()).toEqual([
        201, 409, 409, 409, 409, 409, 409, 409,
      ]);
      expect(
        await e2e.prisma.event.count({
          where: { userId: trainer.id, date: new Date(date) },
        }),
      ).toBe(1);
    });

    it("still books different slots of the same day concurrently", async () => {
      const responses = await Promise.all(
        [0, 2, 4].map((hours) => postSession({ date: at(701, hours) })),
      );

      expect(responses.map((res) => res.status)).toEqual([201, 201, 201]);
    });
  });
});
