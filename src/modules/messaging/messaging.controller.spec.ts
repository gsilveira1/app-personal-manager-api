import { Test, TestingModule } from "@nestjs/testing";
import {
  MessagingController,
  StudentMessagingController,
} from "./messaging.controller";
import { MessagingService } from "./messaging.service";

describe("MessagingControllers", () => {
  let messagingController: MessagingController;
  let studentMessagingController: StudentMessagingController;

  const mockMessagingService = {
    getTenantQueue: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    retryNotification: jest.fn().mockResolvedValue({ message: "Reenviado" }),
    cancelNotification: jest.fn().mockResolvedValue({ message: "Cancelado" }),
    processPendingQueue: jest.fn().mockResolvedValue({
      processedCount: 2,
      successCount: 2,
      failedCount: 0,
      delayedCount: 0,
    }),
    resendLink: jest.fn().mockResolvedValue({ status: "QUEUED" }),
    getClientMessageHistory: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagingController, StudentMessagingController],
      providers: [
        {
          provide: MessagingService,
          useValue: mockMessagingService,
        },
      ],
    }).compile();

    messagingController = module.get<MessagingController>(MessagingController);
    studentMessagingController = module.get<StudentMessagingController>(
      StudentMessagingController,
    );
    jest.clearAllMocks();
  });

  it("should get tenant message queue", async () => {
    const req = { user: { userId: "user-1" } } as any;
    const query = { page: 1, limit: 10, status: "ALL" };
    const result = await messagingController.getQueue(req, query);

    expect(mockMessagingService.getTenantQueue).toHaveBeenCalledWith(
      "user-1",
      query,
    );
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("should process pending message queue", async () => {
    const req = { user: { userId: "user-1" } } as any;
    const result = await messagingController.processQueue(req);

    expect(mockMessagingService.processPendingQueue).toHaveBeenCalledWith(
      "user-1",
      true,
    );
    expect(result).toEqual({
      processedCount: 2,
      successCount: 2,
      failedCount: 0,
      delayedCount: 0,
    });
  });

  it("should retry message delivery", async () => {
    const req = { user: { userId: "user-1" } } as any;
    const result = await messagingController.retryMessage(req, "log-1");

    expect(mockMessagingService.retryNotification).toHaveBeenCalledWith(
      "user-1",
      "log-1",
    );
    expect(result).toEqual({ message: "Reenviado" });
  });

  it("should cancel queued message", async () => {
    const req = { user: { userId: "user-1" } } as any;
    const result = await messagingController.cancelMessage(req, "log-1");

    expect(mockMessagingService.cancelNotification).toHaveBeenCalledWith(
      "user-1",
      "log-1",
    );
    expect(result).toEqual({ message: "Cancelado" });
  });

  it("should get client message history", async () => {
    const req = { user: { userId: "user-1" } } as any;
    const result = await studentMessagingController.getClientMessages(
      req,
      "client-1",
    );

    expect(mockMessagingService.getClientMessageHistory).toHaveBeenCalledWith(
      "user-1",
      "client-1",
    );
    expect(result).toEqual([]);
  });

  it("should resend link", async () => {
    const req = { user: { userId: "user-1" } } as any;
    const result = await studentMessagingController.resendLink(
      req,
      "client-1",
      { type: "ANAMNESIS" },
    );

    expect(mockMessagingService.resendLink).toHaveBeenCalledWith(
      "user-1",
      "client-1",
      "ANAMNESIS",
    );
    expect(result).toEqual({ status: "QUEUED" });
  });
});
