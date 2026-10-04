/**
 * Calendar against a real database (contract 6.4): the unique key and the cascade
 * of series exceptions, conflicts, soft-deleted clients and workout links.
 */
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

describe("Calendar series, exceptions and blocks (e2e)", () => {
  let e2e: E2eApp;
  let trainer: Trainer;
  let stranger: Trainer;
  let clientId: string;
  /** Tomorrow 13:00 UTC, whole seconds: every test offsets from it to stay clear of the others. */
  const base = new Date(Math.floor((Date.now() + DAY) / DAY) * DAY + 13 * HOUR);
  const at = (days: number, hours = 0) =>
    new Date(base.getTime() + days * DAY + hours * HOUR).toISOString();

  beforeAll(async () => {
    e2e = await createE2eApp();
    trainer = await signUpTrainer(e2e, "calendar");
    stranger = await signUpTrainer(e2e, "stranger");
    clientId = (await createClient(e2e, trainer)).id;
  });

  afterAll(async () => {
    await removeTrainers(e2e, [trainer, stranger]);
    await e2e.app.close();
  });

  const session = (body: Record<string, unknown>, as: Trainer = trainer) =>
    e2e
      .http()
      .post("/api/sessions")
      .set(as.auth)
      .send({
        durationMinutes: 60,
        type: "In-Person",
        category: "Workout",
        clientId,
        ...body,
      });

  const listSessions = async (start: string, end: string) => {
    const res = await e2e
      .http()
      .get("/api/sessions")
      .query({ start, end })
      .set(trainer.auth)
      .expect(200);
    return res.body as Array<Record<string, any>>;
  };

  const exceptionsOf = (seriesId: string) =>
    e2e.prisma.event.findMany({ where: { parentEventId: seriesId } });

  const createSeries = async (startDays: number) => {
    const res = await session({
      date: at(startDays),
      rrule: "FREQ=DAILY;COUNT=5",
      notes: "Série",
    }).expect(201);
    return res.body as Record<string, any>;
  };

  describe("series", () => {
    it("POST with rrule answers the master view; the list expands it into occurrences", async () => {
      const master = await createSeries(100);

      expect(master).toMatchObject({
        isVirtual: false,
        rrule: "FREQ=DAILY;COUNT=5",
        recurringEventId: null,
        date: at(100),
      });
      const occurrences = await listSessions(at(100, -1), at(110));
      expect(occurrences.map((o) => o.id)).toEqual(
        [0, 1, 2, 3, 4].map((day) => `${master.id}_${at(100 + day)}`),
      );
      expect(occurrences.every((o) => o.isVirtual && o.notes === "Série")).toBe(
        true,
      );
    });

    it("concurrent first edits of one occurrence all succeed and leave one exception", async () => {
      const master = await createSeries(120);
      const occurrenceId = `${master.id}_${at(121)}`;

      const responses = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) =>
          e2e
            .http()
            .patch(`/api/sessions/${occurrenceId}`)
            .set(trainer.auth)
            .send({ notes: `edição ${n}` }),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual([
        200, 200, 200, 200, 200, 200,
      ]);
      const exceptions = await exceptionsOf(master.id);
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].notes).toMatch(/^edição [1-6]$/);
      // The response keeps addressing the occurrence; the row id is exposed as exceptionId.
      expect(responses[0].body).toMatchObject({
        id: occurrenceId,
        exceptionId: exceptions[0].id,
        recurringEventId: master.id,
        isVirtual: true,
      });
    });

    it("concurrent toggle-complete and cancel of two occurrences write one exception each", async () => {
      const master = await createSeries(130);
      const toggle = (day: number) =>
        e2e
          .http()
          .post(`/api/sessions/${master.id}_${at(day)}/toggle-complete`)
          .set(trainer.auth);
      const cancel = (day: number) =>
        e2e
          .http()
          .delete(`/api/sessions/${master.id}_${at(day)}`)
          .set(trainer.auth);

      const responses = await Promise.all([
        cancel(131),
        cancel(131),
        cancel(131),
        toggle(132),
      ]);

      expect(responses.map((r) => r.status)).toEqual([204, 204, 204, 201]);
      const exceptions = await exceptionsOf(master.id);
      expect(exceptions.map((e) => e.status).sort()).toEqual([
        "CANCELLED",
        "COMPLETED",
      ]);
      const listed = await listSessions(at(130, -1), at(140));
      expect(listed.map((o) => o.id)).not.toContain(`${master.id}_${at(131)}`);
    });

    it("deleting the series cascades to its exceptions", async () => {
      const master = await createSeries(140);
      await e2e
        .http()
        .patch(`/api/sessions/${master.id}_${at(141)}`)
        .set(trainer.auth)
        .send({ cancelled: true })
        .expect(200);
      await e2e
        .http()
        .patch(`/api/sessions/${master.id}_${at(142)}`)
        .set(trainer.auth)
        .send({ date: at(142, 2) })
        .expect(200);
      expect(await exceptionsOf(master.id)).toHaveLength(2);

      await e2e
        .http()
        .delete(`/api/sessions/${master.id}`)
        .set(trainer.auth)
        .expect(204);

      expect(await exceptionsOf(master.id)).toHaveLength(0);
      expect(await e2e.prisma.event.count({ where: { id: master.id } })).toBe(
        0,
      );
      expect(await listSessions(at(140, -1), at(150))).toEqual([]);
    });

    it("refuses an occurrence the rule does not produce, and another trainer", async () => {
      const master = await createSeries(150);

      await e2e
        .http()
        .patch(`/api/sessions/${master.id}_${at(150, 5)}`)
        .set(trainer.auth)
        .send({ notes: "x" })
        .expect(404);
      await e2e
        .http()
        .patch(`/api/sessions/${master.id}_${at(151)}`)
        .set(stranger.auth)
        .send({ notes: "x" })
        .expect(403);
      expect(await exceptionsOf(master.id)).toHaveLength(0);
    });
  });

  describe("conflicts and soft delete", () => {
    it("409 over a session and over a block; a deleted client's sessions stop conflicting and leave the list", async () => {
      const other = await createClient(e2e, trainer);
      await session({ date: at(160), clientId: other.id }).expect(201);
      await e2e
        .http()
        .post("/api/availability-blocks")
        .set(trainer.auth)
        .send({ title: "Almoço", dtstart: at(160, 3), dtend: at(160, 4) })
        .expect(201);

      await session({ date: at(160) }).expect(409);
      await session({ date: at(160, 3) }).expect(409);

      await e2e
        .http()
        .delete(`/api/clients/${other.id}`)
        .set(trainer.auth)
        .expect(204);
      expect(await listSessions(at(160, -1), at(160, 2))).toEqual([]);
      await session({ date: at(160) }).expect(201);
    });

    it("requires a token on /sessions and serves public availability by slug", async () => {
      await e2e.http().get("/api/sessions").expect(401);
      await e2e
        .http()
        .get(`/api/public/${trainer.slug}/availability`)
        .expect(200);
      await e2e.http().get("/api/public/nobody-here/availability").expect(404);
      await e2e
        .http()
        .get(`/api/public/${trainer.slug}/availability`)
        .query({ start: at(0), end: at(100) })
        .expect(400);
    });
  });

  describe("workout link", () => {
    const template = (as: Trainer) =>
      e2e
        .http()
        .post("/api/workout-templates")
        .set(as.auth)
        .send({
          name: "Biblioteca - Pernas",
          workouts: [
            {
              id: "pernas-a",
              letter: "A",
              name: "Pernas",
              blocks: [
                {
                  type: "REGULAR",
                  exercises: [{ exerciseName: "Agachamento" }],
                },
              ],
            },
          ],
        })
        .expect(201);

    it("links one of the trainer's templates to a client's session and resolves it", async () => {
      const sheet = (await template(trainer)).body;

      const created = await session({
        date: at(170),
        workoutSheetId: sheet.id,
        workoutSegmentId: "pernas-a",
      }).expect(201);

      expect(created.body.workout).toEqual({
        id: "pernas-a",
        name: "Pernas",
        letter: "A",
      });
      const [listed] = await listSessions(at(170, -1), at(170, 1));
      expect(listed.workout).toEqual(created.body.workout);
    });

    it("refuses another trainer's template (404) and an unknown segment (400)", async () => {
      const mine = (await template(trainer)).body;
      const theirs = (await template(stranger)).body;

      await session({
        date: at(171),
        workoutSheetId: theirs.id,
        workoutSegmentId: "pernas-a",
      }).expect(404);
      await session({
        date: at(171),
        workoutSheetId: mine.id,
        workoutSegmentId: "nao-existe",
      }).expect(400);
    });
  });

  describe("availability blocks", () => {
    it("PATCH with rrule: null and notes: null turns a recurring block into a one-off", async () => {
      const created = await e2e
        .http()
        .post("/api/availability-blocks")
        .set(trainer.auth)
        .send({
          title: "Estudos",
          dtstart: at(180),
          dtend: at(180, 1.5),
          rrule: "FREQ=WEEKLY",
          notes: "Biomecânica",
        })
        .expect(201);
      expect(created.body).toMatchObject({
        rrule: "FREQ=WEEKLY",
        dtstart: at(180),
        dtend: at(180, 1.5),
      });

      const patched = await e2e
        .http()
        .patch(`/api/availability-blocks/${created.body.id}`)
        .set(trainer.auth)
        .send({ rrule: null, notes: null })
        .expect(200);

      expect(patched.body).toMatchObject({
        id: created.body.id,
        rrule: null,
        notes: null,
        dtend: at(180, 1.5),
      });
      const materialized = await e2e
        .http()
        .get("/api/availability-blocks")
        .query({ start: at(179), end: at(200) })
        .set(trainer.auth)
        .expect(200);
      expect(
        materialized.body.filter(
          (b: { blockId: string }) => b.blockId === created.body.id,
        ),
      ).toHaveLength(1);
    });
  });
});
