/**
 * GET / PATCH /api/settings/language against a real database: the preference
 * lives in the `User.settings` JSONB document (contract 5.1 and 6.1, #13-14).
 *
 * Run: DATABASE_URL=... REDIS_URL=... npm run test:e2e -- settings-language
 */
import {
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
} from "./support/e2e-app";

describe("Settings Language API (e2e)", () => {
  let e2e: E2eApp;
  let trainer: Trainer;

  beforeAll(async () => {
    e2e = await createE2eApp();
    trainer = await signUpTrainer(e2e, "lang");
  });

  afterAll(async () => {
    await removeTrainers(e2e, [trainer]);
    await e2e.app.close();
  });

  beforeEach(async () => {
    // Reset the document before each test for isolation
    await e2e.prisma.user.update({
      where: { id: trainer.id },
      data: { settings: {} },
    });
  });

  const storedSettings = async () => {
    const user = await e2e.prisma.user.findUniqueOrThrow({
      where: { id: trainer.id },
      select: { settings: true },
    });
    return user.settings;
  };

  const patchLanguage = (language: unknown) =>
    e2e
      .http()
      .patch("/api/settings/language")
      .set(trainer.auth)
      .send({ language });

  const getLanguage = () =>
    e2e.http().get("/api/settings/language").set(trainer.auth);

  describe("GET /api/settings/language", () => {
    it('returns the default { language: "pt-BR" } when no preference is stored', async () => {
      const res = await getLanguage().expect(200);

      expect(res.body).toEqual({ language: "pt-BR" });
      expect(await storedSettings()).toEqual({});
    });

    it("returns stored language after a PATCH", async () => {
      await patchLanguage("es").expect(200);

      const res = await getLanguage().expect(200);

      expect(res.body).toEqual({ language: "es" });
    });

    it("returns 401 without JWT token", async () => {
      await e2e.http().get("/api/settings/language").expect(401);
    });
  });

  describe("PATCH /api/settings/language", () => {
    it("stores and returns en in User.settings", async () => {
      const res = await patchLanguage("en").expect(200);

      expect(res.body).toEqual({ language: "en" });
      expect(await storedSettings()).toEqual({ language: "en" });
    });

    it('rejects unsupported locale "fr" with 400 and stores nothing', async () => {
      const res = await patchLanguage("fr").expect(400);

      expect(res.body.message).toBeDefined();
      expect(await storedSettings()).toEqual({});
    });

    it("rejects empty string with 400", async () => {
      await patchLanguage("").expect(400);
    });

    it("rejects missing language field with 400", async () => {
      await e2e
        .http()
        .patch("/api/settings/language")
        .set(trainer.auth)
        .send({})
        .expect(400);
    });

    it("returns 401 without JWT token", async () => {
      await e2e
        .http()
        .patch("/api/settings/language")
        .send({ language: "en" })
        .expect(401);
    });

    it("keeps the other keys of the document", async () => {
      await e2e
        .http()
        .put("/api/settings/ai-instructions")
        .set(trainer.auth)
        .send({ instructions: "Foco em mobilidade." })
        .expect(200);

      await patchLanguage("es").expect(200);
      await patchLanguage("es").expect(200);

      expect(await storedSettings()).toEqual({
        aiInstructions: "Foco em mobilidade.",
        language: "es",
      });
    });

    it("full round-trip: PATCH es → GET → PATCH en → GET returns en", async () => {
      await patchLanguage("es").expect(200);
      expect((await getLanguage().expect(200)).body).toEqual({
        language: "es",
      });

      await patchLanguage("en").expect(200);

      expect((await getLanguage().expect(200)).body).toEqual({
        language: "en",
      });
    });

    it("is reflected in GET /auth/me", async () => {
      await patchLanguage("en").expect(200);

      const me = await e2e
        .http()
        .get("/api/auth/me")
        .set(trainer.auth)
        .expect(200);

      expect(me.body.settings.language).toBe("en");
    });
  });
});
