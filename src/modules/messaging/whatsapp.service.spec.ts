import { ConfigService } from "@nestjs/config";
import {
  InvalidRecipientError,
  WhatsAppInstanceError,
  WhatsAppNotConnectedError,
  WhatsAppTransientError,
} from "../../common/types";
import {
  EvolutionApiError,
  EvolutionNotConfiguredError,
} from "./evolution-api.errors";
import { WhatsAppService } from "./whatsapp.service";

const ENV: Record<string, string | undefined> = {
  EVOLUTION_API_URL: "http://localhost:8080/",
  EVOLUTION_API_KEY: "test_api_key",
};

function buildService(env = ENV) {
  const config = { get: jest.fn((key: string) => env[key]) };
  return new WhatsAppService(config as unknown as ConfigService);
}

function mockResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

function mockFetch(status: number, body: unknown) {
  return jest
    .spyOn(global, "fetch")
    .mockResolvedValueOnce(mockResponse(status, body));
}

describe("WhatsAppService", () => {
  let service: WhatsAppService;

  beforeEach(() => {
    service = buildService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("cleanPhoneNumber", () => {
    it("returns an empty string for null, undefined or empty input", () => {
      expect(service.cleanPhoneNumber("")).toBe("");
      expect(service.cleanPhoneNumber(null as any)).toBe("");
      expect(service.cleanPhoneNumber(undefined as any)).toBe("");
    });

    it("prepends 55 to 11-digit Brazilian mobile numbers", () => {
      expect(service.cleanPhoneNumber("(11) 98765-4321")).toBe("5511987654321");
      expect(service.cleanPhoneNumber("11 98765-4321")).toBe("5511987654321");
      expect(service.cleanPhoneNumber("11987654321")).toBe("5511987654321");
    });

    it("prepends 55 to 10-digit Brazilian landline numbers", () => {
      expect(service.cleanPhoneNumber("(11) 3456-7890")).toBe("551134567890");
      expect(service.cleanPhoneNumber("1134567890")).toBe("551134567890");
    });

    it("keeps an existing country code", () => {
      expect(service.cleanPhoneNumber("+55 (11) 98765-4321")).toBe(
        "5511987654321",
      );
      expect(service.cleanPhoneNumber("5511987654321")).toBe("5511987654321");
      expect(service.cleanPhoneNumber("+55 11 3456-7890")).toBe("551134567890");
    });

    it("only strips non-digits from international numbers", () => {
      expect(service.cleanPhoneNumber("+1 (555) 123-4567")).toBe("15551234567");
      expect(service.cleanPhoneNumber("+351 912 345 678")).toBe("351912345678");
    });
  });

  describe("sendTextMessage", () => {
    const send = (phone = "+5511999998888", text = "Olá!") =>
      service.sendTextMessage("user-abc12345", phone, text);

    it("throws WhatsAppNotConnectedError when the instance name is empty", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      await expect(
        service.sendTextMessage("", "+5511999998888", "Olá!"),
      ).rejects.toBeInstanceOf(WhatsAppNotConnectedError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws InvalidRecipientError for a short or malformed phone", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      await expect(send("123")).rejects.toThrow(InvalidRecipientError);
      await expect(send("123")).rejects.toThrow("Número de telefone inválido");
      await expect(send("")).rejects.toThrow(InvalidRecipientError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws InvalidRecipientError for an empty text", async () => {
      await expect(send("+5511999998888", "   ")).rejects.toThrow(
        "não pode ser vazio",
      );
    });

    it("posts the cleaned number and trimmed text and returns the message id", async () => {
      const fetchSpy = mockFetch(201, { key: { id: "EVOLUTION_MSG_12345" } });

      const result = await send(
        "+55 (11) 99999-8888",
        " Sua ficha está pronta. ",
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:8080/message/sendText/user-abc12345",
        expect.objectContaining({
          method: "POST",
          headers: {
            apikey: "test_api_key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            number: "5511999998888",
            text: "Sua ficha está pronta.",
          }),
          signal: expect.any(AbortSignal),
        }),
      );
      expect(result).toEqual({ messageId: "EVOLUTION_MSG_12345" });
    });

    it.each([404, 401, 400])(
      "throws WhatsAppInstanceError on HTTP %i",
      async (status) => {
        mockFetch(status, {
          status,
          response: {
            message: ['The "user-abc12345" instance does not exist'],
          },
        });

        const error = await send().catch((e) => e);

        expect(error).toBeInstanceOf(WhatsAppInstanceError);
        expect(error.httpStatus).toBe(status);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain("instance does not exist");
      },
    );

    it.each([429, 500, 503])(
      "throws a retryable WhatsAppTransientError on HTTP %i",
      async (status) => {
        mockFetch(status, { error: "upstream unavailable" });

        const error = await send().catch((e) => e);

        expect(error).toBeInstanceOf(WhatsAppTransientError);
        expect(error.retryable).toBe(true);
        expect(error.toLogEntry()).toBe(
          `WHATSAPP_TRANSIENT (HTTP ${status}): upstream unavailable`,
        );
      },
    );

    it("throws WhatsAppTransientError on a network error", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const error = await send().catch((e) => e);

      expect(error).toBeInstanceOf(WhatsAppTransientError);
      expect(error.httpStatus).toBeUndefined();
      expect(error.message).toContain("ECONNREFUSED");
    });

    it.each(["AbortError", "TimeoutError"])(
      "throws WhatsAppTransientError on %s",
      async (name) => {
        const timeout = Object.assign(new Error("aborted"), { name });
        jest.spyOn(global, "fetch").mockRejectedValueOnce(timeout);

        const error = await send().catch((e) => e);

        expect(error).toBeInstanceOf(WhatsAppTransientError);
        expect(error.message).toContain("timed out");
      },
    );

    it("treats HTTP 400 with exists:false as an invalid recipient, not a dead instance", async () => {
      mockFetch(400, {
        status: 400,
        response: {
          message: [{ exists: false, number: "5511999998888" }],
        },
      });

      const error = await send().catch((e) => e);

      expect(error).toBeInstanceOf(InvalidRecipientError);
      expect(error.httpStatus).toBe(400);
    });

    it("uses the raw body as the message when the provider does not answer JSON", async () => {
      mockFetch(502, "<html>Bad Gateway</html>");

      await expect(send()).rejects.toThrow("<html>Bad Gateway</html>");
    });

    it("throws EvolutionApiError for a status the contract does not classify", async () => {
      mockFetch(403, { error: "Forbidden" });

      const error = await send().catch((e) => e);

      expect(error).toBeInstanceOf(EvolutionApiError);
      expect(error.httpStatus).toBe(403);
    });

    it("throws EvolutionNotConfiguredError without URL or key", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      service = buildService({ EVOLUTION_API_URL: "http://localhost:8080" });

      await expect(send()).rejects.toBeInstanceOf(EvolutionNotConfiguredError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("ensureInstance", () => {
    it("calls POST /instance/create", async () => {
      const fetchSpy = mockFetch(201, { instance: { status: "created" } });

      await service.ensureInstance("user-abc12345");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:8080/instance/create",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            instanceName: "user-abc12345",
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
          }),
        }),
      );
    });

    it.each([403, 409])(
      "accepts HTTP %i 'already in use' as success",
      async (status) => {
        mockFetch(status, {
          response: {
            message: ['This name "user-abc12345" is already in use.'],
          },
        });

        await expect(
          service.ensureInstance("user-abc12345"),
        ).resolves.toBeUndefined();
      },
    );

    it("throws EvolutionApiError with the status on any other failure", async () => {
      mockFetch(403, { error: "Forbidden" });

      const error = await service
        .ensureInstance("user-abc12345")
        .catch((e) => e);

      expect(error).toBeInstanceOf(EvolutionApiError);
      expect(error.httpStatus).toBe(403);
    });

    it("throws EvolutionApiError without a status on a network error", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("ECONNRESET"));

      const error = await service
        .ensureInstance("user-abc12345")
        .catch((e) => e);

      expect(error).toBeInstanceOf(EvolutionApiError);
      expect(error.httpStatus).toBeUndefined();
    });
  });

  describe("fetchQrCode", () => {
    it("returns a data URL as is", async () => {
      mockFetch(200, { base64: "data:image/png;base64,AAAA" });
      await expect(service.fetchQrCode("user-abc12345")).resolves.toBe(
        "data:image/png;base64,AAAA",
      );
    });

    it("prefixes a bare base64 payload", async () => {
      mockFetch(200, { base64: "AAAA" });
      await expect(service.fetchQrCode("user-abc12345")).resolves.toBe(
        "data:image/png;base64,AAAA",
      );
    });

    it("renders a QR code from the pairing code", async () => {
      mockFetch(200, { code: "2@pairing-code" });
      await expect(service.fetchQrCode("user-abc12345")).resolves.toMatch(
        /^data:image\/png;base64,/,
      );
    });

    it("throws when the provider returns no QR code", async () => {
      mockFetch(200, { instance: { state: "open" } });
      await expect(service.fetchQrCode("user-abc12345")).rejects.toThrow(
        "returned no QR code",
      );
    });

    it("throws EvolutionApiError with the status on failure", async () => {
      mockFetch(500, "boom");
      const error = await service.fetchQrCode("user-abc12345").catch((e) => e);
      expect(error).toBeInstanceOf(EvolutionApiError);
      expect(error.httpStatus).toBe(500);
    });
  });

  describe("checkInstanceStatus", () => {
    it.each([
      ["open", "CONNECTED"],
      ["connected", "CONNECTED"],
      ["connecting", "CONNECTING"],
      ["close", "DISCONNECTED"],
    ])("maps provider state %s to %s", async (state, expected) => {
      mockFetch(200, { instance: { state } });
      await expect(service.checkInstanceStatus("user-abc12345")).resolves.toBe(
        expected,
      );
    });

    it("reports DISCONNECTED when the instance does not exist (404)", async () => {
      mockFetch(404, "Not Found");
      await expect(service.checkInstanceStatus("user-abc12345")).resolves.toBe(
        "DISCONNECTED",
      );
    });

    it("throws instead of guessing DISCONNECTED when the check fails", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("Connection timeout"));
      await expect(
        service.checkInstanceStatus("user-abc12345"),
      ).rejects.toBeInstanceOf(EvolutionApiError);

      mockFetch(500, "boom");
      await expect(
        service.checkInstanceStatus("user-abc12345"),
      ).rejects.toThrow("Evolution API HTTP 500");
    });
  });

  describe("disconnectInstance", () => {
    it("calls DELETE /instance/logout/{name}", async () => {
      const fetchSpy = mockFetch(200, { status: "LOGGED_OUT" });

      await service.disconnectInstance("user-abc12345");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:8080/instance/logout/user-abc12345",
        expect.objectContaining({
          method: "DELETE",
          headers: { apikey: "test_api_key" },
        }),
      );
    });

    it("treats 404 as already disconnected", async () => {
      mockFetch(404, "Not Found");
      await expect(
        service.disconnectInstance("user-abc12345"),
      ).resolves.toBeUndefined();
    });

    it("throws EvolutionApiError when logout returns 500", async () => {
      mockFetch(500, "Internal Server Error");
      await expect(service.disconnectInstance("user-abc12345")).rejects.toThrow(
        "Evolution API HTTP 500",
      );
    });

    it("throws EvolutionApiError on a network error", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("Network timeout"));
      await expect(
        service.disconnectInstance("user-abc12345"),
      ).rejects.toBeInstanceOf(EvolutionApiError);
    });
  });
});
