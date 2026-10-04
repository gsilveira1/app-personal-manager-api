import {
  BadGatewayException,
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { UserDirectory } from "../../common/ports";
import {
  InvalidRecipientError,
  WhatsAppInstanceError,
} from "../../common/types";
import {
  EvolutionApiError,
  EvolutionNotConfiguredError,
} from "./evolution-api.errors";
import {
  defaultInstanceName,
  WhatsappConnectionService,
} from "./whatsapp-connection.service";
import { WhatsAppService } from "./whatsapp.service";

const USER_ID = "3f2a9c1e-0000-4000-8000-000000000001";
const NEW_INSTANCE = `user-${USER_ID}`;

describe("WhatsappConnectionService", () => {
  const users = {
    getWhatsappConnection: jest.fn(),
    setWhatsappConnection: jest.fn(),
  };
  const whatsapp = {
    ensureInstance: jest.fn(),
    fetchQrCode: jest.fn(),
    checkInstanceStatus: jest.fn(),
    disconnectInstance: jest.fn(),
    sendTextMessage: jest.fn(),
  };
  const service = new WhatsappConnectionService(
    users as unknown as UserDirectory,
    whatsapp as unknown as WhatsAppService,
  );
  let warnLog: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    warnLog = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    errorLog = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    users.setWhatsappConnection.mockImplementation(async (_id, patch) => ({
      instanceName: "user-3f2a9c1e",
      status: "PENDING",
      ...patch,
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  describe("defaultInstanceName (regression L6: the name used to carry only 32 bits of the id)", () => {
    it("names a new instance user-<full user id>", () => {
      expect(defaultInstanceName(USER_ID)).toBe(`user-${USER_ID}`);
    });

    it("gives two trainers whose ids share the first 8 characters different instances", () => {
      const twin = "3f2a9c1e-ffff-4fff-8fff-ffffffffffff";

      expect(defaultInstanceName(twin)).not.toBe(defaultInstanceName(USER_ID));
    });
  });

  describe("connect", () => {
    beforeEach(() => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: null,
        status: "PENDING",
      });
      whatsapp.fetchQrCode.mockResolvedValue("data:image/png;base64,AAAA");
    });

    it("creates the instance, fetches the QR code and stores PENDING", async () => {
      const result = await service.connect(USER_ID);

      expect(whatsapp.ensureInstance).toHaveBeenCalledWith(NEW_INSTANCE);
      expect(whatsapp.fetchQrCode).toHaveBeenCalledWith(NEW_INSTANCE);
      expect(users.setWhatsappConnection).toHaveBeenCalledWith(USER_ID, {
        instanceName: NEW_INSTANCE,
        status: "PENDING",
      });
      expect(result).toEqual({
        instanceName: NEW_INSTANCE,
        qrcodeBase64: "data:image/png;base64,AAAA",
        status: "PENDING",
      });
    });

    it("reuses the stored instance name", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: "tenant-vivi-001",
        status: "DISCONNECTED",
      });

      const result = await service.connect(USER_ID);

      expect(whatsapp.ensureInstance).toHaveBeenCalledWith("tenant-vivi-001");
      expect(result.instanceName).toBe("tenant-vivi-001");
    });

    it("keeps honouring a short legacy name already stored for the user", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: "user-3f2a9c1e",
        status: "DISCONNECTED",
      });

      const result = await service.connect(USER_ID);

      expect(whatsapp.ensureInstance).toHaveBeenCalledWith("user-3f2a9c1e");
      expect(whatsapp.fetchQrCode).toHaveBeenCalledWith("user-3f2a9c1e");
      expect(result.instanceName).toBe("user-3f2a9c1e");
    });

    it("answers 503 without provider configuration and stores nothing (no placeholder QR)", async () => {
      whatsapp.ensureInstance.mockRejectedValue(
        new EvolutionNotConfiguredError(),
      );

      await expect(service.connect(USER_ID)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });

    it("answers 502 and logs the upstream status when the provider fails", async () => {
      whatsapp.fetchQrCode.mockRejectedValue(
        new EvolutionApiError("Evolution API HTTP 500: boom", 500),
      );

      await expect(service.connect(USER_ID)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("upstream HTTP 500"),
      );
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });

    it("propagates an unknown user", async () => {
      users.getWhatsappConnection.mockRejectedValue(new NotFoundException());

      await expect(service.connect(USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("getStatus", () => {
    const stored = (
      status: string,
      instanceName: string | null = "user-3f2a9c1e",
    ) =>
      users.getWhatsappConnection.mockResolvedValue({ instanceName, status });

    it("returns the stored status without a live check when there is no instance", async () => {
      stored("PENDING", null);

      await expect(service.getStatus(USER_ID)).resolves.toEqual({
        instanceName: null,
        status: "PENDING",
      });
      expect(whatsapp.checkInstanceStatus).not.toHaveBeenCalled();
    });

    it("returns CONNECTED without writing when live and stored agree", async () => {
      stored("CONNECTED");
      whatsapp.checkInstanceStatus.mockResolvedValue("CONNECTED");

      await expect(service.getStatus(USER_ID)).resolves.toEqual({
        instanceName: "user-3f2a9c1e",
        status: "CONNECTED",
      });
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });

    it("stores CONNECTED when the live check says so", async () => {
      stored("PENDING");
      whatsapp.checkInstanceStatus.mockResolvedValue("CONNECTED");

      const result = await service.getStatus(USER_ID);

      expect(users.setWhatsappConnection).toHaveBeenCalledWith(USER_ID, {
        status: "CONNECTED",
      });
      expect(result.status).toBe("CONNECTED");
    });

    it("stores DISCONNECTED when a connected instance dropped", async () => {
      stored("CONNECTED");
      whatsapp.checkInstanceStatus.mockResolvedValue("DISCONNECTED");

      const result = await service.getStatus(USER_ID);

      expect(users.setWhatsappConnection).toHaveBeenCalledWith(USER_ID, {
        status: "DISCONNECTED",
      });
      expect(result.status).toBe("DISCONNECTED");
    });

    it.each([
      ["PENDING", "DISCONNECTED"],
      ["PENDING", "CONNECTING"],
      ["CONNECTED", "CONNECTING"],
    ])("keeps stored %s when live is %s", async (storedStatus, live) => {
      stored(storedStatus);
      whatsapp.checkInstanceStatus.mockResolvedValue(live);

      const result = await service.getStatus(USER_ID);

      expect(result.status).toBe(storedStatus);
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });

    it("returns the stored status and logs a warning when the live check fails", async () => {
      stored("CONNECTED");
      whatsapp.checkInstanceStatus.mockRejectedValue(
        new EvolutionApiError("Evolution API HTTP 500: boom", 500),
      );

      const result = await service.getStatus(USER_ID);

      expect(result.status).toBe("CONNECTED");
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
      expect(warnLog).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));
    });

    it("does not hide an unexpected error behind the stored status", async () => {
      stored("CONNECTED");
      const bug = new TypeError("boom");
      whatsapp.checkInstanceStatus.mockRejectedValue(bug);

      await expect(service.getStatus(USER_ID)).rejects.toBe(bug);
    });
  });

  describe("disconnect", () => {
    it("logs out on the provider, then stores DISCONNECTED", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: "user-3f2a9c1e",
        status: "CONNECTED",
      });

      const result = await service.disconnect(USER_ID);

      expect(whatsapp.disconnectInstance).toHaveBeenCalledWith("user-3f2a9c1e");
      expect(users.setWhatsappConnection).toHaveBeenCalledWith(USER_ID, {
        status: "DISCONNECTED",
      });
      expect(result).toEqual({
        success: true,
        status: "DISCONNECTED",
        instanceName: "user-3f2a9c1e",
      });
    });

    it("stores DISCONNECTED without calling the provider when there is no instance", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: null,
        status: "PENDING",
      });
      users.setWhatsappConnection.mockResolvedValue({
        instanceName: null,
        status: "DISCONNECTED",
      });

      const result = await service.disconnect(USER_ID);

      expect(whatsapp.disconnectInstance).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        status: "DISCONNECTED",
        instanceName: null,
      });
    });

    it("answers 502 and keeps the stored status when the provider fails", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: "user-3f2a9c1e",
        status: "CONNECTED",
      });
      whatsapp.disconnectInstance.mockRejectedValue(
        new EvolutionApiError("Evolution API HTTP 500: boom", 500),
      );

      await expect(service.disconnect(USER_ID)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(users.setWhatsappConnection).not.toHaveBeenCalled();
    });
  });

  describe("sendTestMessage", () => {
    const dto = { phone: "+5511999998888", message: "Teste" };

    it("400 when the trainer has no instance", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: null,
        status: "PENDING",
      });

      await expect(service.sendTestMessage(USER_ID, dto)).rejects.toThrow(
        "Instância do WhatsApp não configurada.",
      );
    });

    it("sends directly and returns the message id", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: "user-3f2a9c1e",
        status: "CONNECTED",
      });
      whatsapp.sendTextMessage.mockResolvedValue({ messageId: "MSG_TEST_123" });

      const result = await service.sendTestMessage(USER_ID, dto);

      expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(
        "user-3f2a9c1e",
        "+5511999998888",
        "Teste",
      );
      expect(result).toEqual({ success: true, messageId: "MSG_TEST_123" });
    });

    it.each([
      new WhatsAppInstanceError("Instance disconnected", 400),
      new InvalidRecipientError("Número de telefone inválido: 123"),
      new EvolutionApiError("Evolution API HTTP 403: Forbidden", 403),
    ])(
      "turns a delivery error into 400 with its message (%s)",
      async (error) => {
        users.getWhatsappConnection.mockResolvedValue({
          instanceName: "user-3f2a9c1e",
          status: "CONNECTED",
        });
        whatsapp.sendTextMessage.mockRejectedValue(error);

        const thrown = await service
          .sendTestMessage(USER_ID, dto)
          .catch((e) => e);

        expect(thrown).toBeInstanceOf(BadRequestException);
        expect(thrown.message).toBe(error.message);
        expect(users.setWhatsappConnection).not.toHaveBeenCalled();
      },
    );

    it("503 without provider configuration", async () => {
      users.getWhatsappConnection.mockResolvedValue({
        instanceName: "user-3f2a9c1e",
        status: "CONNECTED",
      });
      whatsapp.sendTextMessage.mockRejectedValue(
        new EvolutionNotConfiguredError(),
      );

      await expect(
        service.sendTestMessage(USER_ID, dto),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
