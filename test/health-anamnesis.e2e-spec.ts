/**
 * Anamnesis magic token against a real database (contract 6.5): the token is
 * single-use even when two submissions race (`updateMany` claim, count === 1).
 */
import { AssessmentType } from "@prisma/client";

import {
  createClient,
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
} from "./support/e2e-app";

describe("Anamnesis magic token (e2e)", () => {
  let e2e: E2eApp;
  let trainer: Trainer;

  beforeAll(async () => {
    e2e = await createE2eApp();
    trainer = await signUpTrainer(e2e, "anamnesis");
  });

  afterAll(async () => {
    await removeTrainers(e2e, [trainer]);
    await e2e.app.close();
  });

  const issueToken = async (clientId: string): Promise<string> => {
    const res = await e2e
      .http()
      .post(`/api/anamnesis/student/${clientId}/magic-link`)
      .set(trainer.auth)
      .expect(201);
    return res.body.token;
  };

  const submit = (token: string, answers: Record<string, unknown> = {}) =>
    e2e
      .http()
      .post("/api/anamnesis/submit")
      .send({ token, fitnessGoals: "Hipertrofia", ...answers });

  const evaluationsOf = (clientId: string) =>
    e2e.prisma.assessment.findMany({
      where: { clientId, type: AssessmentType.PHYSICAL_EVALUATION },
    });

  it("two concurrent submissions with one token: exactly one wins, one evaluation is created", async () => {
    // Several rounds: a race that is lost only sometimes must still be caught.
    for (let round = 0; round < 5; round += 1) {
      const client = await createClient(e2e, trainer);
      const token = await issueToken(client.id);

      const responses = await Promise.all([
        submit(token, { weightKg: 70 }),
        submit(token, { weightKg: 71 }),
        submit(token, { weightKg: 72 }),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 401, 401]);
      expect(await evaluationsOf(client.id)).toHaveLength(1);
      const anamneses = await e2e.prisma.assessment.findMany({
        where: { clientId: client.id, type: AssessmentType.ANAMNESIS },
      });
      expect(anamneses).toHaveLength(1);
      expect(anamneses[0].magicToken).toBeNull();
    }
  });

  it("a used token is refused by the form and by a second submission", async () => {
    const client = await createClient(e2e, trainer);
    const token = await issueToken(client.id);
    await e2e.http().get(`/api/anamnesis/form?token=${token}`).expect(200);

    await submit(token).expect(200);

    await submit(token).expect(401);
    await e2e.http().get(`/api/anamnesis/form?token=${token}`).expect(401);
    // No weight sent: no evaluation is invented (assumption A13).
    expect(await evaluationsOf(client.id)).toHaveLength(0);
  });

  it("rejects weightKg 0 with 400 and leaves the token usable (regression: weight-0 evaluation)", async () => {
    const client = await createClient(e2e, trainer);
    const token = await issueToken(client.id);

    await submit(token, { weightKg: 0 }).expect(400);

    expect(await evaluationsOf(client.id)).toHaveLength(0);
    await submit(token, { weightKg: 64.5 }).expect(200);
    const [evaluation] = await evaluationsOf(client.id);
    expect(evaluation.data).toMatchObject({ version: 1, weight: 64.5 });
  });

  it("lists PENDING and SUBMITTED requests, newest first, with the latest submission current", async () => {
    const client = await createClient(e2e, trainer);
    const first = await issueToken(client.id);
    await submit(first).expect(200);
    await issueToken(client.id);

    const res = await e2e
      .http()
      .get(`/api/anamnesis/student/${client.id}`)
      .set(trainer.auth)
      .expect(200);

    expect(
      res.body.map((row: { status: string; isCurrent: boolean }) => [
        row.status,
        row.isCurrent,
      ]),
    ).toEqual([
      ["PENDING", false],
      ["SUBMITTED", true],
    ]);
    expect(res.body[0].token).toBeUndefined();
    expect(res.body[0].magicToken).toBeUndefined();
  });

  it("a soft-deleted client's token answers 404", async () => {
    const client = await createClient(e2e, trainer);
    const token = await issueToken(client.id);
    await e2e
      .http()
      .delete(`/api/clients/${client.id}`)
      .set(trainer.auth)
      .expect(204);

    await submit(token).expect(404);
  });
});
