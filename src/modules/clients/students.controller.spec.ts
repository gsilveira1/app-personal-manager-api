import { Test, TestingModule } from "@nestjs/testing";
import { StudentsController } from "./students.controller";
import { ClientsService } from "./clients.service";
import { AnamnesisService } from "../anamnesis/anamnesis.service";

describe("StudentsController", () => {
  let controller: StudentsController;
  let clientsService: ClientsService;
  let anamnesisService: AnamnesisService;

  const mockClientsService = {
    create: jest.fn(),
    findStudents: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    recordManualPayment: jest.fn(),
    updateStudentStatus: jest.fn(),
    exportCsv: jest.fn(),
    getActivityHeatmap: jest.fn(),
    getExpiringSheets: jest.fn(),
    remove: jest.fn(),
  };

  const mockAnamnesisService = {
    requestReassessment: jest.fn(),
  };

  const mockReq = {
    user: { userId: "user-123", email: "trainer@example.com" },
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudentsController],
      providers: [
        {
          provide: ClientsService,
          useValue: mockClientsService,
        },
        {
          provide: AnamnesisService,
          useValue: mockAnamnesisService,
        },
      ],
    }).compile();

    controller = module.get<StudentsController>(StudentsController);
    clientsService = module.get<ClientsService>(ClientsService);
    anamnesisService = module.get<AnamnesisService>(AnamnesisService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should create a student", async () => {
    const dto = {
      name: "João Silva",
      email: "joao@example.com",
      phone: "+5511999998888",
      type: "Online",
      modality: "ONLINE",
    };
    mockClientsService.create.mockResolvedValue({ id: "student-1", ...dto });

    const result = await controller.create(mockReq, dto as any);
    expect(clientsService.create).toHaveBeenCalledWith("user-123", dto);
    expect(result.id).toBe("student-1");
  });

  it("should find students with pagination and query", async () => {
    const query = { page: 1, limit: 10, search: "João", modality: "ONLINE" };
    mockClientsService.findStudents.mockResolvedValue({
      items: [{ id: "student-1", name: "João" }],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    const result = await controller.findAll(mockReq, query);
    expect(clientsService.findStudents).toHaveBeenCalledWith("user-123", query);
    expect(result.total).toBe(1);
  });

  it("should record manual payment", async () => {
    const paymentDto = {
      paymentType: "MANUAL_PIX",
      validUntil: "2026-10-20T00:00:00.000Z",
      notes: "Pago via Pix",
    };
    mockClientsService.recordManualPayment.mockResolvedValue({
      message: "Pagamento manual registrado com sucesso",
    });

    const result = await controller.recordManualPayment(
      mockReq,
      "student-1",
      paymentDto as any,
    );
    expect(clientsService.recordManualPayment).toHaveBeenCalledWith(
      "user-123",
      "student-1",
      paymentDto,
    );
    expect(result.message).toBeDefined();
  });

  it("should update student status to PAUSED", async () => {
    mockClientsService.updateStudentStatus.mockResolvedValue({
      id: "student-1",
      status: "PAUSED",
    });

    const result = await controller.updateStatus(mockReq, "student-1", {
      status: "PAUSED" as any,
    });
    expect(clientsService.updateStudentStatus).toHaveBeenCalledWith(
      "user-123",
      "student-1",
      "PAUSED",
    );
    expect(result.status).toBe("PAUSED");
  });

  it("should get activity heatmap", async () => {
    mockClientsService.getActivityHeatmap.mockResolvedValue({
      studentId: "student-1",
      totalCompletedMonth: 10,
      currentStreak: 4,
      days: [],
    });

    const result = await controller.getActivityHeatmap(
      mockReq,
      "student-1",
      30,
    );
    expect(clientsService.getActivityHeatmap).toHaveBeenCalledWith(
      "user-123",
      "student-1",
      30,
    );
    expect(result.currentStreak).toBe(4);
  });

  it("should request reassessment", async () => {
    mockAnamnesisService.requestReassessment.mockResolvedValue({
      message:
        "Solicitação de reavaliação enfileirada no WhatsApp com sucesso.",
    });

    const result = await controller.requestReassessment(mockReq, "student-1");
    expect(anamnesisService.requestReassessment).toHaveBeenCalledWith(
      "user-123",
      "student-1",
    );
    expect(result.message).toContain("WhatsApp");
  });
});
