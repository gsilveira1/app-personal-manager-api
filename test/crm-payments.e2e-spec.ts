/**
 * Payment transaction and soft delete against a real database (contract 6.2, 7).
 * The unit specs mock Prisma, so `client.update({ where: { id, userId, deletedAt: null } })`
 * and the rollback of the payment row were never executed before.
 */
import { CLIENT_DIRECTORY, ClientDirectory } from "../src/common/ports";
import {
  createClient,
  createE2eApp,
  E2eApp,
  removeTrainers,
  signUpTrainer,
  Trainer,
} from "./support/e2e-app";

describe("Client payments and soft delete (e2e)", () => {
  let e2e: E2eApp;
  let trainer: Trainer;

  const payment = {
    amount: 350,
    method: "PIX",
    periodEnd: "2027-01-31T23:59:59.000Z",
  };

  beforeAll(async () => {
    e2e = await createE2eApp();
    trainer = await signUpTrainer(e2e, "payments");
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await removeTrainers(e2e, [trainer]);
    await e2e.app.close();
  });

  const pay = (clientId: string) =>
    e2e
      .http()
      .post(`/api/clients/${clientId}/payments`)
      .set(trainer.auth)
      .send(payment);

  it("records the payment and reactivates the client in one transaction", async () => {
    const client = await createClient(e2e, trainer, { status: "OVERDUE" });

    const res = await pay(client.id).expect(201);

    expect(res.body.payment).toMatchObject({
      clientId: client.id,
      provider: "MANUAL",
      status: "PAID",
      amount: 350,
      method: "PIX",
    });
    expect(res.body.client).toMatchObject({
      status: "ACTIVE",
      subscriptionStatus: "ACTIVE",
      currentPeriodEnd: payment.periodEnd,
    });
    const detail = await e2e
      .http()
      .get(`/api/clients/${client.id}`)
      .set(trainer.auth)
      .expect(200);
    expect(detail.body.payments).toHaveLength(1);
  });

  it("a client soft-deleted between the ownership check and the write → 404 and no payment row", async () => {
    const client = await createClient(e2e, trainer);
    // Deterministic race: the delete lands right after the ownership check passed.
    const directory = e2e.app.get<ClientDirectory>(CLIENT_DIRECTORY);
    const requireOwned = directory.requireOwned.bind(directory);
    jest
      .spyOn(directory, "requireOwned")
      .mockImplementation(async (userId, clientId) => {
        const summary = await requireOwned(userId, clientId);
        await e2e.prisma.client.update({
          where: { id: clientId },
          data: { deletedAt: new Date() },
        });
        return summary;
      });

    const res = await pay(client.id).expect(404);

    expect(res.body.message).toContain(client.id);
    expect(
      await e2e.prisma.payment.count({ where: { clientId: client.id } }),
    ).toBe(0);
    const row = await e2e.prisma.client.findUniqueOrThrow({
      where: { id: client.id },
    });
    expect(row.currentPeriodEnd).toBeNull();
  });

  it("a payment on an already deleted client → 404 and no payment row", async () => {
    const client = await createClient(e2e, trainer);
    await e2e
      .http()
      .delete(`/api/clients/${client.id}`)
      .set(trainer.auth)
      .expect(204);

    await pay(client.id).expect(404);

    expect(
      await e2e.prisma.payment.count({ where: { clientId: client.id } }),
    ).toBe(0);
  });

  it("the public lead form resurrects a deleted client with its payments, and refuses a live one", async () => {
    const client = await createClient(e2e, trainer);
    await pay(client.id).expect(201);
    await e2e
      .http()
      .delete(`/api/clients/${client.id}`)
      .set(trainer.auth)
      .expect(204);
    const lead = {
      name: "Aluna de Volta",
      email: client.email.toUpperCase(),
      phone: "+5553988887777",
      interest: "online",
    };

    const res = await e2e
      .http()
      .post(`/api/public/${trainer.slug}/leads`)
      .send(lead)
      .expect(201);

    expect(res.body).toEqual({ id: client.id });
    const detail = await e2e
      .http()
      .get(`/api/clients/${client.id}`)
      .set(trainer.auth)
      .expect(200);
    expect(detail.body).toMatchObject({
      status: "LEAD",
      subscriptionStatus: null,
    });
    expect(detail.body.payments).toHaveLength(1);
    // Now the e-mail belongs to a live client: the public form must not touch it.
    await e2e
      .http()
      .post(`/api/public/${trainer.slug}/leads`)
      .send(lead)
      .expect(409);
  });
});
