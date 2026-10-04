import { RequestMethod } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../../common/auth";
import { WhatsappConnectionService } from "./whatsapp-connection.service";
import { WhatsappController } from "./whatsapp.controller";

const routeOf = (handler: keyof WhatsappController) => ({
  path: Reflect.getMetadata("path", WhatsappController.prototype[handler]),
  method: Reflect.getMetadata("method", WhatsappController.prototype[handler]),
  code: Reflect.getMetadata(
    "__httpCode__",
    WhatsappController.prototype[handler],
  ),
});

describe("WhatsappController", () => {
  let controller: WhatsappController;
  const connection = {
    connect: jest.fn(),
    getStatus: jest.fn(),
    disconnect: jest.fn(),
    sendTestMessage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [{ provide: WhatsappConnectionService, useValue: connection }],
    }).compile();
    controller = moduleRef.get(WhatsappController);
  });

  it("requires a JWT and lives under /whatsapp", () => {
    expect(Reflect.getMetadata("__guards__", WhatsappController)).toEqual([
      JwtAuthGuard,
    ]);
    expect(Reflect.getMetadata("path", WhatsappController)).toBe("whatsapp");
  });

  it("maps the contract routes, all answering 200", () => {
    expect(routeOf("connect")).toEqual({
      path: "connect",
      method: RequestMethod.POST,
      code: 200,
    });
    expect(routeOf("getStatus")).toMatchObject({
      path: "status",
      method: RequestMethod.GET,
    });
    expect(routeOf("disconnect")).toEqual({
      path: "disconnect",
      method: RequestMethod.POST,
      code: 200,
    });
    expect(routeOf("sendTestMessage")).toEqual({
      path: "test-message",
      method: RequestMethod.POST,
      code: 200,
    });
  });

  it("connects WhatsApp", async () => {
    const response = {
      instanceName: "user-3f2a9c1e",
      qrcodeBase64: "data:image/png;base64,mock",
      status: "PENDING",
    };
    connection.connect.mockResolvedValue(response);

    await expect(controller.connect("user-1")).resolves.toEqual(response);
    expect(connection.connect).toHaveBeenCalledWith("user-1");
  });

  it("gets the WhatsApp status", async () => {
    const status = { instanceName: "user-3f2a9c1e", status: "CONNECTED" };
    connection.getStatus.mockResolvedValue(status);

    await expect(controller.getStatus("user-1")).resolves.toEqual(status);
    expect(connection.getStatus).toHaveBeenCalledWith("user-1");
  });

  it("disconnects WhatsApp", async () => {
    const response = {
      success: true,
      status: "DISCONNECTED",
      instanceName: "user-3f2a9c1e",
    };
    connection.disconnect.mockResolvedValue(response);

    await expect(controller.disconnect("user-1")).resolves.toEqual(response);
    expect(connection.disconnect).toHaveBeenCalledWith("user-1");
  });

  it("sends a test message", async () => {
    const dto = { phone: "+5511999998888", message: "Teste" };
    connection.sendTestMessage.mockResolvedValue({
      success: true,
      messageId: "MSG_TEST_123",
    });

    await expect(controller.sendTestMessage("user-1", dto)).resolves.toEqual({
      success: true,
      messageId: "MSG_TEST_123",
    });
    expect(connection.sendTestMessage).toHaveBeenCalledWith("user-1", dto);
  });
});
