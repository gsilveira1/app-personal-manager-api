import { Test } from "@nestjs/testing";

import { ClientPaymentsService } from "./client-payments.service";
import { ClientsController } from "./clients.controller";
import { ClientsService } from "./clients.service";

describe("ClientsController", () => {
  let controller: ClientsController;
  let clients: Record<string, jest.Mock>;
  let payments: { record: jest.Mock };

  const userId = "trainer-uuid-1";

  beforeEach(async () => {
    clients = {
      create: jest.fn(),
      findPage: jest.fn(),
      findLeads: jest.fn(),
      exportCsv: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      updateStatus: jest.fn(),
      convertLead: jest.fn(),
      generateAvatarUploadUrl: jest.fn(),
      remove: jest.fn(),
    };
    payments = { record: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        { provide: ClientsService, useValue: clients },
        { provide: ClientPaymentsService, useValue: payments },
      ],
    }).compile();
    controller = moduleRef.get(ClientsController);
  });

  it("POST / delegates to create with the user id", async () => {
    const dto = { name: "Maria", email: "maria@test.com", phone: "123" };
    clients.create.mockResolvedValue({ id: "1", welcomeMessage: "QUEUED" });

    const result = await controller.create(userId, dto as any);

    expect(clients.create).toHaveBeenCalledWith(userId, dto);
    expect(result.welcomeMessage).toBe("QUEUED");
  });

  it("GET / delegates to findPage with the query", async () => {
    const query = { page: 1, limit: 10, search: "João", modality: "ONLINE" };
    clients.findPage.mockResolvedValue({
      items: [],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    const result = await controller.findPage(userId, query);

    expect(clients.findPage).toHaveBeenCalledWith(userId, query);
    expect(result.total).toBe(1);
  });

  it("GET /leads delegates to findLeads", async () => {
    clients.findLeads.mockResolvedValue([]);

    await controller.findLeads(userId);

    expect(clients.findLeads).toHaveBeenCalledWith(userId);
  });

  it("GET /export/csv returns the CSV text", async () => {
    clients.exportCsv.mockResolvedValue("Nome\n");

    await expect(controller.exportCsv(userId)).resolves.toBe("Nome\n");
    expect(clients.exportCsv).toHaveBeenCalledWith(userId);
  });

  it("GET /:id delegates to findOne", async () => {
    clients.findOne.mockResolvedValue({ id: "client-1" });

    await controller.findOne(userId, "client-1");

    expect(clients.findOne).toHaveBeenCalledWith(userId, "client-1");
  });

  it("PATCH /:id delegates to update with the body", async () => {
    clients.update.mockResolvedValue({ id: "client-1", name: "Updated" });

    await controller.update(userId, "client-1", { name: "Updated" });

    expect(clients.update).toHaveBeenCalledWith(userId, "client-1", {
      name: "Updated",
    });
  });

  it("PATCH /:id/status delegates the parsed status", async () => {
    clients.updateStatus.mockResolvedValue({ id: "c", status: "PAUSED" });

    const result = await controller.updateStatus(userId, "client-1", {
      status: "PAUSED",
    });

    expect(clients.updateStatus).toHaveBeenCalledWith(
      userId,
      "client-1",
      "PAUSED",
    );
    expect(result.status).toBe("PAUSED");
  });

  it("PATCH /:id/convert passes the planId from the body", async () => {
    await controller.convertLead(userId, "client-1", { planId: "plan-uuid" });

    expect(clients.convertLead).toHaveBeenCalledWith(
      userId,
      "client-1",
      "plan-uuid",
    );
  });

  it("PATCH /:id/convert without planId passes undefined", async () => {
    await controller.convertLead(userId, "client-1", {});

    expect(clients.convertLead).toHaveBeenCalledWith(
      userId,
      "client-1",
      undefined,
    );
  });

  it("POST /:id/avatar-upload-url passes the content type", async () => {
    await controller.generateAvatarUploadUrl(userId, "client-1", {
      contentType: "image/png",
    });

    expect(clients.generateAvatarUploadUrl).toHaveBeenCalledWith(
      userId,
      "client-1",
      "image/png",
    );
  });

  it("DELETE /:id delegates to remove", async () => {
    await controller.remove(userId, "client-1");

    expect(clients.remove).toHaveBeenCalledWith(userId, "client-1");
  });

  it("POST /:id/payments delegates to the payments service", async () => {
    const dto = {
      amount: 150,
      method: "PIX" as const,
      periodEnd: "2026-10-20T00:00:00.000Z",
      notes: "Pago via Pix",
    };
    payments.record.mockResolvedValue({ message: "ok" });

    const result = await controller.recordPayment(userId, "client-1", dto);

    expect(payments.record).toHaveBeenCalledWith(userId, "client-1", dto);
    expect(result.message).toBeDefined();
  });
});
