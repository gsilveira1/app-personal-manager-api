import { RequestMethod } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../../common/auth";
import {
  ClientMessagesController,
  MessagingController,
} from "./messaging.controller";
import { MessagingHistoryService } from "./messaging-history.service";
import { PendingNotificationsService } from "./pending-notifications.service";

const routeOf = (controller: any, handler: string) => ({
  prefix: Reflect.getMetadata("path", controller),
  path: Reflect.getMetadata("path", controller.prototype[handler]),
  method: Reflect.getMetadata("method", controller.prototype[handler]),
  code: Reflect.getMetadata("__httpCode__", controller.prototype[handler]),
});

describe("Messaging controllers", () => {
  let messaging: MessagingController;
  let clientMessages: ClientMessagesController;
  const history = { getLogs: jest.fn(), getClientMessages: jest.fn() };
  const pending = { list: jest.fn(), flush: jest.fn(), cancel: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [MessagingController, ClientMessagesController],
      providers: [
        { provide: MessagingHistoryService, useValue: history },
        { provide: PendingNotificationsService, useValue: pending },
      ],
    }).compile();
    messaging = moduleRef.get(MessagingController);
    clientMessages = moduleRef.get(ClientMessagesController);
  });

  it.each([MessagingController, ClientMessagesController])(
    "%p requires a JWT",
    (controller) => {
      expect(Reflect.getMetadata("__guards__", controller)).toEqual([
        JwtAuthGuard,
      ]);
    },
  );

  it("maps the contract routes", () => {
    expect(routeOf(MessagingController, "getLogs")).toMatchObject({
      prefix: "messaging",
      path: "logs",
      method: RequestMethod.GET,
    });
    expect(routeOf(MessagingController, "getPending")).toMatchObject({
      path: "pending",
      method: RequestMethod.GET,
    });
    expect(routeOf(MessagingController, "flushPending")).toMatchObject({
      path: "pending/flush",
      method: RequestMethod.POST,
      code: 200,
    });
    expect(routeOf(MessagingController, "cancelPending")).toMatchObject({
      path: "pending/:jobId",
      method: RequestMethod.DELETE,
      code: 200,
    });
    expect(
      routeOf(ClientMessagesController, "getClientMessages"),
    ).toMatchObject({
      prefix: "clients/:id",
      path: "messages",
      method: RequestMethod.GET,
    });
  });

  it("GET /messaging/logs returns the caller's audit page", async () => {
    const page = { items: [], total: 0 };
    history.getLogs.mockResolvedValue(page);
    const query = { page: 1, limit: 10, status: "ALL" };

    await expect(messaging.getLogs("user-1", query)).resolves.toBe(page);
    expect(history.getLogs).toHaveBeenCalledWith("user-1", query);
  });

  it("GET /messaging/pending lists the caller's pending jobs", async () => {
    pending.list.mockResolvedValue([{ jobId: "j1" }]);

    await expect(messaging.getPending("user-1")).resolves.toEqual([
      { jobId: "j1" },
    ]);
    expect(pending.list).toHaveBeenCalledWith("user-1");
  });

  it("POST /messaging/pending/flush promotes the caller's delayed jobs", async () => {
    pending.flush.mockResolvedValue({ promotedCount: 2, message: "ok" });

    await expect(messaging.flushPending("user-1")).resolves.toEqual({
      promotedCount: 2,
      message: "ok",
    });
    expect(pending.flush).toHaveBeenCalledWith("user-1");
  });

  it("DELETE /messaging/pending/:jobId cancels the job", async () => {
    pending.cancel.mockResolvedValue({ message: "Cancelado" });

    await expect(messaging.cancelPending("user-1", "job-1")).resolves.toEqual({
      message: "Cancelado",
    });
    expect(pending.cancel).toHaveBeenCalledWith("user-1", "job-1");
  });

  it("GET /clients/:id/messages returns the client's history", async () => {
    history.getClientMessages.mockResolvedValue([]);

    await expect(
      clientMessages.getClientMessages("user-1", "client-1"),
    ).resolves.toEqual([]);
    expect(history.getClientMessages).toHaveBeenCalledWith(
      "user-1",
      "client-1",
    );
  });
});
