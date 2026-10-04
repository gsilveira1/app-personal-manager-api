/**
 * Security review, input handling, against the real pipeline and database:
 * M2 (bounds on public and token routes), M5 (AI payload validation),
 * H4 (public lead form never replaces a stored name or phone), L9 (CORS allow-list).
 */
import {
  createClient,
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
  unique,
} from "./support/e2e-app";

describe("Review: input bounds and public lead form (e2e)", () => {
  let e2e: E2eApp;
  let trainer: Trainer;

  beforeAll(async () => {
    e2e = await createE2eApp();
    trainer = await signUpTrainer(e2e, "input");
  });

  afterAll(async () => {
    await removeTrainers(e2e, [trainer]);
    await e2e.app.close();
  });

  const lead = (overrides: Record<string, unknown> = {}) => ({
    name: "Carlos Lead",
    email: `${unique("lead")}@e2e.test`,
    phone: "+55 53 99900-1122",
    interest: "presencial",
    ...overrides,
  });
  const postLead = (body: Record<string, unknown>) =>
    e2e.http().post(`/api/public/${trainer.slug}/leads`).send(body);

  describe("M2: bounds", () => {
    it.each([
      ["a 201-character name", { name: "a".repeat(201) }],
      ["a 2001-character message", { message: "a".repeat(2001) }],
      ["a phone that is not a phone", { phone: "call me <b>now</b>" }],
    ])("public lead form answers 400 for %s", async (_label, overrides) => {
      await postLead(lead(overrides)).expect(400);
    });

    it("public lead form still accepts a normal submission", async () => {
      const res = await postLead(lead({ message: "Quero começar!" })).expect(
        201,
      );
      expect(res.body).toEqual({ id: expect.any(String) });
    });

    it.each([
      ["a javascript: photo URL", { frontPhotoUrl: "javascript:alert(1)" }],
      [
        "a 1,000-key parqAnswers",
        {
          parqAnswers: Object.fromEntries(
            Array.from({ length: 1000 }, (_, i) => [`q${i}`, true]),
          ),
        },
      ],
      ["a 5001-character answer", { medicalHistory: "a".repeat(5001) }],
    ])("anamnesis submit answers 400 for %s", async (_label, answers) => {
      await e2e
        .http()
        .post("/api/anamnesis/submit")
        .send({ token: "any-token", ...answers })
        .expect(400);
    });

    it.each([
      ["durationSeconds 2**31", { durationSeconds: 2 ** 31 }],
      [
        "a completedAt one day in the future",
        { completedAt: new Date(Date.now() + 86_400_000).toISOString() },
      ],
      ["a completedAt from 2001", { completedAt: "2001-01-01T00:00:00.000Z" }],
    ])("POST /student/sessions answers 400 for %s", async (_label, body) => {
      await e2e
        .http()
        .post("/api/student/sessions?token=any-token")
        .send({ workoutId: "w-1", durationSeconds: 60, ...body })
        .expect(400);
    });
  });

  describe("M5: AI payloads", () => {
    it("POST /ai/workout-plan answers 400 for a 20k-character goal", async () => {
      await e2e
        .http()
        .post("/api/ai/workout-plan")
        .set(trainer.auth)
        .send({
          clientName: "Maria",
          goal: "a".repeat(20_000),
          experienceLevel: "Iniciante",
          daysPerWeek: 3,
        })
        .expect(400);
    });
  });

  describe("H4: resurrection through the public form", () => {
    it("keeps the stored name and phone and appends the submission to the notes", async () => {
      const client = await createClient(e2e, trainer, {
        name: "Maria Verdadeira",
        phone: "+5553911112222",
        notes: "Aluna desde 2024.",
      });
      await e2e
        .http()
        .delete(`/api/clients/${client.id}`)
        .set(trainer.auth)
        .expect((res) => expect(res.status).toBeLessThan(300));

      const res = await postLead({
        name: "Atacante",
        email: client.email,
        phone: "+5553900000000",
        interest: "online",
        message: "Quero voltar!",
      }).expect(201);

      expect(res.body.id).toBe(client.id);
      const row = await e2e.prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(row).toMatchObject({
        name: "Maria Verdadeira",
        phone: "+5553911112222",
        status: "LEAD",
        modality: "ONLINE",
        deletedAt: null,
      });
      expect(row.notes).toContain("Aluna desde 2024.");
      expect(row.notes).toContain("Nome informado: Atacante");
      expect(row.notes).toContain("Telefone informado: +5553900000000");
      expect(row.notes).toContain("Mensagem: Quero voltar!");
    });

    it("answers 409 for a live client's e-mail and changes nothing", async () => {
      const client = await createClient(e2e, trainer, { name: "Viva" });

      await postLead(lead({ email: client.email, name: "Outro" })).expect(409);

      const row = await e2e.prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(row.name).toBe("Viva");
    });
  });

  describe("L9: CORS allow-list", () => {
    const preflight = (origin: string) =>
      e2e
        .http()
        .options(`/api/public/${trainer.slug}/leads`)
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST");

    it("an unlisted origin gets no Access-Control-Allow-Origin", async () => {
      const res = await preflight("https://evil.example.com");

      expect(res.headers).not.toHaveProperty("access-control-allow-origin");
    });

    it("the configured frontend origin is echoed back", async () => {
      const res = await preflight("http://localhost:5173");

      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://localhost:5173",
      );
    });
  });
});
