import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadGatewayException, Logger, NotFoundException } from "@nestjs/common";
import { USER_DIRECTORY } from "../../common/ports";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";

const mockGenerateContent = jest.fn();

jest.mock("@google/genai", () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
    Type: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      NUMBER: "NUMBER",
      ARRAY: "ARRAY",
    },
  };
});

describe("AiService & AiController", () => {
  let service: AiService;
  let controller: AiController;
  let users: { getSettings: jest.Mock };
  let logError: jest.SpyInstance;

  const userId = "trainer-1";
  const planDto = {
    clientName: "Maria Silva",
    goal: "Hipertrofia",
    experienceLevel: "Intermediário",
    daysPerWeek: 4,
  };
  const insightsDto = {
    client: { name: "Maria Silva", goal: "Emagrecimento" },
    archivedPlans: [],
  };
  const promptOf = (call = 0) =>
    mockGenerateContent.mock.calls[call][0].contents as string;

  beforeEach(async () => {
    jest.clearAllMocks();
    users = {
      getSettings: jest.fn().mockResolvedValue({ aiInstructions: "" }),
    };
    logError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        AiService,
        { provide: USER_DIRECTORY, useValue: users },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "GEMINI_API_KEY") return "test-key";
              return null;
            },
          },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    controller = module.get<AiController>(AiController);
  });

  afterEach(() => logError.mockRestore());

  it("should be defined", () => {
    expect(service).toBeDefined();
    expect(controller).toBeDefined();
  });

  describe("generateWorkoutPlan", () => {
    it("should generate structured workout plan JSON", async () => {
      const mockResult = {
        title: "Treino de Hipertrofia",
        description: "Foco em membros superiores",
        exercises: [
          {
            name: "Supino Reto",
            sets: 4,
            reps: "10-12",
            notes: "Carga moderada",
          },
        ],
        tags: ["Hipertrofia", "Peito"],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult),
      });

      const result = await controller.generateWorkoutPlan(userId, planDto);
      expect(result).toEqual(mockResult);
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it("answers 502 when the provider returns empty text", async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: "" });

      await expect(
        controller.generateWorkoutPlan(userId, planDto),
      ).rejects.toThrow(BadGatewayException);
      expect(logError).toHaveBeenCalled();
    });

    it("answers 502 when the provider returns text that is not JSON", async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: "<html>oops</html>" });

      await expect(
        controller.generateWorkoutPlan(userId, planDto),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe("generateWorkoutInsights", () => {
    it("should generate structured workout insights JSON", async () => {
      const mockResult = {
        insights: [
          {
            suggestion: {
              name: "Agachamento Búlgaro",
              sets: 3,
              reps: "10-12",
              notes: "Estabilidade",
            },
            reason: "Fortalecer quadríceps respeitando sensibilidade no joelho",
          },
        ],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockResult),
      });

      const result = await controller.generateWorkoutInsights(
        userId,
        insightsDto,
      );
      expect(result).toEqual(mockResult);
      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });

  describe("provider failures (review M5)", () => {
    const providerError = Object.assign(
      new Error(
        "[GoogleGenerativeAI Error]: API key AIzaSy-LEAKED not valid for project 4242",
      ),
      { status: 403 },
    );

    it.each([
      [
        "generateWorkoutPlan",
        () => service.generateWorkoutPlan(userId, planDto),
      ],
      [
        "generateWorkoutInsights",
        () => service.generateWorkoutInsights(userId, insightsDto),
      ],
    ])(
      "%s answers a generic 502 and keeps the provider text in the log only",
      async (_name, call) => {
        mockGenerateContent.mockRejectedValueOnce(providerError);

        const failure = await call().then(
          () => null,
          (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(BadGatewayException);
        const body = JSON.stringify(
          (failure as BadGatewayException).getResponse(),
        );
        expect(body).not.toContain("AIzaSy-LEAKED");
        expect(body).not.toContain("GoogleGenerativeAI");
        expect(body).not.toContain("4242");
        const logged = logError.mock.calls
          .map((args) => String(args[0]))
          .join("\n");
        expect(logged).toContain("status=403");
        expect(logged).toContain("AIzaSy-LEAKED");
      },
    );
  });

  describe("trainer instructions (settings.aiInstructions)", () => {
    beforeEach(() => {
      mockGenerateContent.mockResolvedValue({ text: "{}" });
    });

    it("uses the stored aiInstructions when the request carries none", async () => {
      users.getSettings.mockResolvedValue({
        aiInstructions: "Sempre em inglês.",
      });

      await service.generateWorkoutPlan(userId, planDto);

      expect(users.getSettings).toHaveBeenCalledWith(userId);
      expect(promptOf()).toContain("Sempre em inglês.");
      expect(promptOf()).not.toContain("personal trainer experiente");
    });

    it("prefers the instructions sent with the request", async () => {
      users.getSettings.mockResolvedValue({ aiInstructions: "Guardadas." });

      await service.generateWorkoutInsights(userId, {
        ...insightsDto,
        customInstructions: "Da requisição.",
      });

      expect(promptOf()).toContain("Da requisição.");
      expect(promptOf()).not.toContain("Guardadas.");
    });

    it("falls back to the default persona when neither is set", async () => {
      await service.generateWorkoutPlan(userId, planDto);

      expect(promptOf()).toContain("personal trainer experiente");
    });

    it("does not hide a failure to read the settings", async () => {
      users.getSettings.mockRejectedValue(new NotFoundException());

      await expect(
        service.generateWorkoutPlan(userId, planDto),
      ).rejects.toThrow(NotFoundException);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });
});
