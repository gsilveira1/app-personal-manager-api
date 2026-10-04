/**
 * Identity against a real database and the real adapter-pg driver (contract 6.1):
 * which column a unique violation names, and the row lock that protects the
 * read-modify-write of the `User.settings` document.
 */
import {
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
  unique,
} from "./support/e2e-app";

describe("Identity: unique violations and settings lock (e2e)", () => {
  let e2e: E2eApp;
  let owner: Trainer;
  let other: Trainer;
  const extra: string[] = [];

  beforeAll(async () => {
    e2e = await createE2eApp();
    owner = await signUpTrainer(e2e, "owner");
    other = await signUpTrainer(e2e, "other");
  });

  afterAll(async () => {
    await removeTrainers(e2e, [owner, other]);
    await e2e.prisma.user.deleteMany({ where: { id: { in: extra } } });
    await e2e.app.close();
  });

  const patchProfile = (trainer: Trainer, body: Record<string, unknown>) =>
    e2e.http().patch("/api/users/profile").set(trainer.auth).send(body);

  describe("PATCH /users/profile on a unique violation", () => {
    it("names the e-mail when the e-mail is taken", async () => {
      const res = await patchProfile(other, {
        email: owner.email.toUpperCase(),
      }).expect(409);

      expect(res.body.message).toBe("Este e-mail já está em uso.");
    });

    it("names the slug when the slug is taken", async () => {
      const res = await patchProfile(other, { slug: owner.slug }).expect(409);

      expect(res.body.message).toBe(
        "Este endereço público (slug) já está em uso.",
      );
    });

    it("accepts a free slug, which then serves the public routes", async () => {
      const slug = unique("studio-").toLowerCase();

      await patchProfile(other, { slug }).expect(200);

      await e2e.http().get(`/api/public/${slug}/plans`).expect(200);
      await e2e.http().get(`/api/public/${other.slug}/plans`).expect(404);
      other.slug = slug;
    });
  });

  describe("POST /auth/signup", () => {
    it("answers 409 for a registered e-mail and gives a second account of the same name a suffixed slug", async () => {
      const name = `Studio ${unique("x")}`;
      const password = "TestPass123!";
      const signup = (email: string) =>
        e2e.http().post("/api/auth/signup").send({ name, email, password });
      const email = `${unique("dup")}@e2e.test`;

      const first = await signup(email).expect(201);
      const second = await signup(`${unique("dup")}@e2e.test`).expect(201);
      extra.push(first.body.user.id, second.body.user.id);

      const conflict = await signup(email).expect(409);
      expect(conflict.body.message).toBe("Este e-mail já está em uso.");
      expect(second.body.user.slug).toMatch(
        new RegExp(`^${first.body.user.slug}-[a-z0-9]{4}$`),
      );
    });

    it("rejects a role in the body (nobody signs up as admin)", async () => {
      await e2e
        .http()
        .post("/api/auth/signup")
        .send({
          name: "Mallory",
          email: `${unique("mallory")}@e2e.test`,
          password: "TestPass123!",
          role: "admin",
        })
        .expect(400);
    });
  });

  describe("User.settings under concurrent writers", () => {
    it("keeps every key when the trainer and an admin write different keys at once", async () => {
      // The owner becomes an admin (only the seed can create one) and logs in again for a token with that role.
      await e2e.prisma.user.update({
        where: { id: owner.id },
        data: { role: "admin" },
      });
      const login = await e2e
        .http()
        .post("/api/auth/login")
        .send({ email: owner.email, password: "TestPass123!" })
        .expect(200);
      const admin = { Authorization: `Bearer ${login.body.accessToken}` };

      for (let round = 0; round < 5; round += 1) {
        await e2e.prisma.user.update({
          where: { id: other.id },
          data: { settings: {} },
        });
        const startHour = 1 + round;
        const instructions = `Rodada ${round}`;

        const responses = await Promise.all([
          e2e
            .http()
            .patch("/api/settings/dnd")
            .set(other.auth)
            .send({ startHour, endHour: 6 }),
          e2e
            .http()
            .patch("/api/settings/language")
            .set(other.auth)
            .send({ language: "es" }),
          e2e
            .http()
            .put("/api/settings/ai-instructions")
            .set(other.auth)
            .send({ instructions }),
          e2e
            .http()
            .patch(`/api/admin/users/${other.id}`)
            .set(admin)
            .send({ limits: { maxStudents: 10 + round } }),
        ]);

        expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
        const user = await e2e.prisma.user.findUniqueOrThrow({
          where: { id: other.id },
          select: { settings: true },
        });
        expect(user.settings).toMatchObject({
          language: "es",
          aiInstructions: instructions,
          dnd: { startHour, endHour: 6 },
          limits: { maxStudents: 10 + round },
        });
      }
    });

    it("answers 403 on /admin/users to a trainer and 401 without a token", async () => {
      await e2e.http().get("/api/admin/users").set(other.auth).expect(403);
      await e2e.http().get("/api/admin/users").expect(401);
    });
  });

  describe("POST /auth/reset-password", () => {
    it("redeems a token once when two requests race", async () => {
      await e2e
        .http()
        .post("/api/auth/forgot-password")
        .send({ email: other.email })
        .expect(200);
      const mail = e2e.mailer.sent.find((m) => m.to === other.email);
      expect(mail?.token).toBeDefined();
      const reset = () =>
        e2e
          .http()
          .post("/api/auth/reset-password")
          .send({ token: mail?.token, password: "NewPass12345!" });

      const responses = await Promise.all([reset(), reset()]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
      await e2e
        .http()
        .post("/api/auth/login")
        .send({ email: other.email, password: "NewPass12345!" })
        .expect(200);
    });
  });
});
