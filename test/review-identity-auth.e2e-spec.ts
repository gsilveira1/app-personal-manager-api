/**
 * Security-review regressions of the session guard, against the whole application:
 *  - M1: a student-portal token is not a trainer session;
 *  - M4: an access token dies with the account (deleted, blocked, password changed)
 *        and the role comes from the database, not from the token.
 */
import { JwtService } from "@nestjs/jwt";

import {
  createClient,
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
} from "./support/e2e-app";

const PASSWORD = "TestPass123!";

describe("Session guard (security review, e2e)", () => {
  let e2e: E2eApp;
  let admin: Trainer;
  let adminAuth: { Authorization: string };
  const created: Trainer[] = [];

  const newTrainer = async (label: string): Promise<Trainer> => {
    const trainer = await signUpTrainer(e2e, label);
    created.push(trainer);
    return trainer;
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const me = (auth: { Authorization: string }) =>
    e2e.http().get("/api/auth/me").set(auth);

  beforeAll(async () => {
    e2e = await createE2eApp();
    // Only the seed can create an admin: promote in the database, then log in.
    admin = await newTrainer("revadmin");
    await e2e.prisma.user.update({
      where: { id: admin.id },
      data: { role: "admin" },
    });
    const login = await e2e
      .http()
      .post("/api/auth/login")
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    adminAuth = bearer(login.body.accessToken);
  });

  afterAll(async () => {
    await removeTrainers(e2e, created);
    await e2e.app.close();
  });

  describe("M1: student-portal token", () => {
    let trainer: Trainer;
    let portalToken: string;

    beforeAll(async () => {
      trainer = await newTrainer("revportal");
      const client = await createClient(e2e, trainer);
      const link = await e2e
        .http()
        .post(`/api/clients/${client.id}/magic-link`)
        .set(trainer.auth)
        .expect(201);
      portalToken = link.body.token;
    });

    it("is refused by POST /ai/workout-plan", async () => {
      await e2e
        .http()
        .post("/api/ai/workout-plan")
        .set(bearer(portalToken))
        .send({})
        .expect(401);
    });

    it("is refused by GET /exercises and GET /auth/me", async () => {
      await e2e
        .http()
        .get("/api/exercises")
        .set(bearer(portalToken))
        .expect(401);
      await me(bearer(portalToken)).expect(401);
    });

    it("still opens the student portal, by header and by query string", async () => {
      const byHeader = await e2e
        .http()
        .get("/api/student/workout-sheet")
        .set(bearer(portalToken));
      const byQuery = await e2e
        .http()
        .get(`/api/student/workout-sheet?token=${portalToken}`);

      expect([byHeader.status, byQuery.status]).toEqual([200, 200]);
    });

    it("a trainer session token is not a portal token", async () => {
      const res = await e2e
        .http()
        .get("/api/student/workout-sheet")
        .set(trainer.auth);

      expect([401, 403]).toContain(res.status);
    });

    it("the trainer's own session still reaches GET /exercises", async () => {
      await e2e.http().get("/api/exercises").set(trainer.auth).expect(200);
    });
  });

  describe("M4: the token does not outlive the account", () => {
    it("answers 401 after an admin deletes the account", async () => {
      const trainer = await newTrainer("revdeleted");
      await me(trainer.auth).expect(200);

      await e2e
        .http()
        .delete(`/api/admin/users/${trainer.id}`)
        .set(adminAuth)
        .expect(204);

      await me(trainer.auth).expect(401);
    });

    it("answers 401 after an admin blocks the account, and 200 again once unblocked", async () => {
      const trainer = await newTrainer("revblocked");
      const setStatus = (status: string) =>
        e2e
          .http()
          .patch(`/api/admin/users/${trainer.id}`)
          .set(adminAuth)
          .send({ status })
          .expect(200);

      await setStatus("BLOCKED");
      await me(trainer.auth).expect(401);
      await e2e.http().get("/api/clients").set(trainer.auth).expect(401);

      await setStatus("ACTIVE");
      await me(trainer.auth).expect(200);
    });

    it("answers 401 to a token issued before a password change; a new login works", async () => {
      const trainer = await newTrainer("revpassword");
      const newPassword = "OutraSenha456!";

      await e2e
        .http()
        .patch("/api/users/profile")
        .set(trainer.auth)
        .send({ password: newPassword })
        .expect(200);

      await me(trainer.auth).expect(401);
      const login = await e2e
        .http()
        .post("/api/auth/login")
        .send({ email: trainer.email, password: newPassword })
        .expect(200);
      await me(bearer(login.body.accessToken)).expect(200);
    });

    it("takes the role from the database: demoting an admin takes effect on the live token", async () => {
      const trainer = await newTrainer("revdemoted");
      await e2e.prisma.user.update({
        where: { id: trainer.id },
        data: { role: "admin" },
      });
      const login = await e2e
        .http()
        .post("/api/auth/login")
        .send({ email: trainer.email, password: PASSWORD })
        .expect(200);
      const auth = bearer(login.body.accessToken);
      await e2e.http().get("/api/admin/users").set(auth).expect(200);

      await e2e.prisma.user.update({
        where: { id: trainer.id },
        data: { role: "trainer" },
      });

      await e2e.http().get("/api/admin/users").set(auth).expect(403);
    });

    it("refuses a correctly signed token without the session audience", async () => {
      const trainer = await newTrainer("revaudience");
      const noAudience = e2e.app
        .get(JwtService, { strict: false })
        .sign({ sub: trainer.id, username: "x", role: "trainer" });

      await me(bearer(noAudience)).expect(401);
    });
  });
});
