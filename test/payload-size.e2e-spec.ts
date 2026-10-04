/**
 * Body limits of the deployed HTTP pipeline (review M2): 100 kb by default,
 * 1 MB only on the routes that carry a document. See `bodyLimitFor` in
 * src/app.setup.ts.
 */
import {
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
} from "./support/e2e-app";

const KB = 1024;

describe("Payload Size Limit (e2e)", () => {
  let e2e: E2eApp;
  let trainer: Trainer;

  beforeAll(async () => {
    e2e = await createE2eApp();
    trainer = await signUpTrainer(e2e, "payload");
  });

  afterAll(async () => {
    await removeTrainers(e2e, [trainer]);
    await e2e.app.close();
  });

  it("rejects a body above 100 kb on the public lead route with 413", async () => {
    const res = await e2e
      .http()
      .post(`/api/public/${trainer.slug}/leads`)
      .send({
        name: "Carlos",
        email: "carlos@e2e.test",
        phone: "53999001122",
        interest: "online",
        message: "a".repeat(101 * KB),
      });

    expect(res.status).toBe(413);
  });

  it("rejects a body above 100 kb on login with 413", async () => {
    const res = await e2e
      .http()
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "a".repeat(101 * KB) });

    expect(res.status).toBe(413);
  });

  it("parses a 90 kb body on a default route (refused by validation, not by size)", async () => {
    const res = await e2e
      .http()
      .post("/api/auth/login")
      .send({
        email: "test@example.com",
        password: "password",
        extra: "a".repeat(90 * KB),
      });

    // The body is parsed (not 413) and then refused: `extra` is not whitelisted.
    expect(res.status).toBe(400);
  });

  it("parses a 500 kb body on a workout-structure route and rejects 1.1 MB with 413", async () => {
    const send = (bytes: number) =>
      e2e
        .http()
        .post("/api/workout-templates")
        .set(trainer.auth)
        .send({ padding: "a".repeat(bytes) });

    expect((await send(500 * KB)).status).toBe(400);
    expect((await send(1100 * KB)).status).toBe(413);
  });
});
