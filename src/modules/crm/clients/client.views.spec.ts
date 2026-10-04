import {
  toClientDetail,
  toClientListItem,
  toClientView,
  toPaymentView,
} from "./client.views";

const clientRow = (overrides: Record<string, unknown> = {}) => ({
  id: "client-1",
  name: "Maria Santos",
  email: "maria@example.com",
  phone: "53999001122",
  status: "ACTIVE" as const,
  modality: "PRESENCIAL" as const,
  goal: null,
  avatar: null,
  notes: null,
  dateOfBirth: new Date("1995-03-15T00:00:00.000Z"),
  checkInFreq: "Weekly",
  medicalHistory: { objective: ["Saúde"] },
  notificationEnabled: true,
  deletedAt: null,
  planId: "plan-1",
  plan: { id: "plan-1", name: "Básico" },
  subscriptionStatus: "ACTIVE" as const,
  currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
  gatewayCustomerId: null,
  userId: "trainer-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  ...overrides,
});

const paymentRow = {
  id: "pay-1",
  clientId: "client-1",
  userId: "trainer-1",
  provider: "MANUAL" as const,
  status: "PAID" as const,
  amount: 150,
  method: "PIX",
  externalId: null,
  date: new Date("2026-10-01T00:00:00.000Z"),
  periodEnd: new Date("2026-11-01T00:00:00.000Z"),
  notes: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
};

describe("client views", () => {
  it("maps a row to the ClientView of the contract", () => {
    expect(toClientView(clientRow() as any)).toEqual({
      id: "client-1",
      name: "Maria Santos",
      email: "maria@example.com",
      phone: "53999001122",
      status: "ACTIVE",
      modality: "PRESENCIAL",
      goal: null,
      avatar: null,
      notes: null,
      dateOfBirth: "1995-03-15T00:00:00.000Z",
      checkInFreq: "Weekly",
      checkInFrequency: "Weekly",
      medicalHistory: { objective: ["Saúde"] },
      notificationEnabled: true,
      planId: "plan-1",
      plan: { id: "plan-1", name: "Básico" },
      subscriptionStatus: "ACTIVE",
      currentPeriodEnd: "2026-11-01T00:00:00.000Z",
      gatewayCustomerId: null,
      userId: "trainer-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("never exposes deletedAt", () => {
    expect(toClientView(clientRow() as any)).not.toHaveProperty("deletedAt");
  });

  it("maps a client without plan, birth date or period", () => {
    const view = toClientView(
      clientRow({
        plan: null,
        planId: null,
        dateOfBirth: null,
        currentPeriodEnd: null,
      }) as any,
    );

    expect(view.plan).toBeNull();
    expect(view.dateOfBirth).toBeNull();
    expect(view.currentPeriodEnd).toBeNull();
  });

  it("attaches the active workout sheet to a list item", () => {
    const item = toClientListItem(clientRow() as any, {
      id: "sheet-1",
      name: "Ficha A",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });

    expect(item.activeWorkoutSheet).toEqual({
      id: "sheet-1",
      name: "Ficha A",
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    expect(toClientListItem(clientRow() as any, undefined)).toMatchObject({
      activeWorkoutSheet: null,
    });
  });

  it("maps a payment row", () => {
    expect(toPaymentView(paymentRow)).toEqual({
      ...paymentRow,
      date: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-11-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("maps the detail with the full plan and the payments", () => {
    const detail = toClientDetail(
      clientRow({
        plan: {
          id: "plan-1",
          type: "PRESENCIAL",
          name: "Básico",
          sessionsPerWeek: 3,
          durationMinutes: 60,
          price: 200,
          active: true,
          features: ["automated_pix"],
          userId: "trainer-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          _count: { clients: 2 },
        },
        payments: [paymentRow],
      }) as any,
    );

    expect(detail.plan).toMatchObject({
      id: "plan-1",
      features: ["automated_pix"],
      _count: { clients: 2 },
    });
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0].amount).toBe(150);
    expect(detail).not.toHaveProperty("deletedAt");
  });
});
