import { Test, TestingModule } from "@nestjs/testing";
import { WhatsAppService } from "./whatsapp.service";

describe("WhatsAppService", () => {
  let service: WhatsAppService;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      EVOLUTION_API_URL: "http://localhost:8080",
      EVOLUTION_API_KEY: "test_api_key",
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WhatsAppService],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe("cleanPhoneNumber (Phone Number Sanitizer)", () => {
    it("should return empty string for null, undefined, or empty inputs", () => {
      expect(service.cleanPhoneNumber("")).toBe("");
      expect(service.cleanPhoneNumber(null as any)).toBe("");
      expect(service.cleanPhoneNumber(undefined as any)).toBe("");
    });

    it("should prepend '55' to 11-digit Brazilian mobile numbers with special characters", () => {
      expect(service.cleanPhoneNumber("(11) 98765-4321")).toBe("5511987654321");
      expect(service.cleanPhoneNumber("11 98765-4321")).toBe("5511987654321");
      expect(service.cleanPhoneNumber("11987654321")).toBe("5511987654321");
    });

    it("should prepend '55' to 10-digit Brazilian landline numbers", () => {
      expect(service.cleanPhoneNumber("(11) 3456-7890")).toBe("551134567890");
      expect(service.cleanPhoneNumber("1134567890")).toBe("551134567890");
    });

    it("should preserve existing country code '55' for full 12 or 13 digit numbers", () => {
      expect(service.cleanPhoneNumber("+55 (11) 98765-4321")).toBe(
        "5511987654321",
      );
      expect(service.cleanPhoneNumber("5511987654321")).toBe("5511987654321");
      expect(service.cleanPhoneNumber("+55 11 3456-7890")).toBe("551134567890");
    });

    it("should preserve international numbers without alterations beyond stripping non-digits", () => {
      expect(service.cleanPhoneNumber("+1 (555) 123-4567")).toBe("15551234567");
      expect(service.cleanPhoneNumber("+351 912 345 678")).toBe("351912345678");
    });
  });

  describe("sendTextMessage (Evolution API Client)", () => {
    it("should return error if instanceName is missing", async () => {
      const result = await service.sendTextMessage(
        "",
        "+5511999998888",
        "Olá!",
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("instance name is not configured");
    });

    it("should return error if recipient phone is invalid or too short", async () => {
      const result = await service.sendTextMessage("tenant-1", "123", "Olá!");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Número de telefone inválido");
    });

    it("should return error if text message is empty", async () => {
      const result = await service.sendTextMessage(
        "tenant-1",
        "+5511999998888",
        "   ",
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("não pode ser vazio");
    });

    it("should successfully send message when Evolution API returns 200/201", async () => {
      const mockFetch = jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          key: { id: "EVOLUTION_MSG_12345" },
          status: "PENDING",
        }),
      } as any);

      const result = await service.sendTextMessage(
        "tenant-vivi-001",
        "+55 (11) 99999-8888",
        "Olá! Sua ficha de treinos está pronta.",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/message/sendText/tenant-vivi-001",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: "test_api_key",
          },
          body: JSON.stringify({
            number: "5511999998888",
            text: "Olá! Sua ficha de treinos está pronta.",
          }),
        }),
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("EVOLUTION_MSG_12345");
    });

    it("should handle Evolution API HTTP 404 when instance does not exist", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({
            status: 404,
            error: "Not Found",
            response: {
              message: ['The "tenant-vivi-001" instance does not exist'],
            },
          }),
      } as any);

      const result = await service.sendTextMessage(
        "tenant-vivi-001",
        "+5511999998888",
        "Test message",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Evolution API HTTP 404");
      expect(result.error).toContain(
        'The "tenant-vivi-001" instance does not exist',
      );
    });

    it("should handle Evolution API HTTP failure response (400/500)", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ error: "Instance not found or disconnected" }),
      } as any);

      const result = await service.sendTextMessage(
        "tenant-vivi-001",
        "+5511999998888",
        "Test message",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Evolution API HTTP 400");
      expect(result.error).toContain("Instance not found or disconnected");
    });

    it("should handle network exception gracefully (Zero Silent Failures)", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await service.sendTextMessage(
        "tenant-vivi-001",
        "+5511999998888",
        "Test message",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Network error calling Evolution API: ECONNREFUSED",
      );
    });
  });

  describe("createInstance (Evolution API Provisioning)", () => {
    it("should return error if instanceName is empty", async () => {
      const result = await service.createInstance("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("instance name is empty");
    });

    it("should call POST /instance/create and return success when Evolution API succeeds", async () => {
      const mockFetch = jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          instance: { instanceName: "tenant-vivi-001", status: "created" },
        }),
      } as any);

      const result = await service.createInstance("tenant-vivi-001");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/instance/create",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: "test_api_key",
          },
          body: JSON.stringify({
            instanceName: "tenant-vivi-001",
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
          }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data.instance.instanceName).toBe("tenant-vivi-001");
    });

    it("should handle error response when createInstance fails", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ error: "Instance already exists" }),
      } as any);

      const result = await service.createInstance("tenant-vivi-001");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Evolution API HTTP 409");
    });
  });

  describe("checkInstanceStatus", () => {
    it("should return DISCONNECTED when instanceName is empty", async () => {
      const result = await service.checkInstanceStatus("");
      expect(result.status).toBe("DISCONNECTED");
    });

    it("should return CONNECTED when Evolution API returns open state", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ instance: { state: "open" } }),
      } as any);

      const result = await service.checkInstanceStatus("tenant-vivi-001");
      expect(result.status).toBe("CONNECTED");
    });

    it("should return DISCONNECTED when Evolution API returns close state or error", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ instance: { state: "close" } }),
      } as any);

      const result = await service.checkInstanceStatus("tenant-vivi-001");
      expect(result.status).toBe("DISCONNECTED");
    });

    it("should handle network error when checking instance status", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("Connection timeout"));

      const result = await service.checkInstanceStatus("tenant-vivi-001");
      expect(result.status).toBe("DISCONNECTED");
      expect(result.error).toBe("Connection timeout");
    });
  });

  describe("disconnectInstance", () => {
    it("should return error if instanceName is empty", async () => {
      const result = await service.disconnectInstance("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("instance name is empty");
    });

    it("should successfully disconnect when Evolution API returns 200", async () => {
      const mockFetch = jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "LOGGED_OUT" }),
      } as any);

      const result = await service.disconnectInstance("tenant-vivi-001");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/instance/logout/tenant-vivi-001",
        expect.objectContaining({
          method: "DELETE",
          headers: { apikey: "test_api_key" },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("should handle 404 gracefully as successfully disconnected", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      } as any);

      const result = await service.disconnectInstance("tenant-vivi-001");
      expect(result.success).toBe(true);
    });

    it("should handle failure response when logout returns 500", async () => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as any);

      const result = await service.disconnectInstance("tenant-vivi-001");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Evolution API HTTP 500");
    });

    it("should handle network exception gracefully", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("Network timeout"));

      const result = await service.disconnectInstance("tenant-vivi-001");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error calling Evolution API logout");
    });
  });
});
