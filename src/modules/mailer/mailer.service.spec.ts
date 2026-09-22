import { Test, TestingModule } from "@nestjs/testing";
import { MailerService } from "./mailer.service";
import * as nodemailer from "nodemailer";

jest.mock("nodemailer");

describe("MailerService", () => {
  let service: MailerService;
  let sendMailMock: jest.Mock;

  beforeEach(async () => {
    sendMailMock = jest
      .fn()
      .mockResolvedValue({ messageId: "mock-message-id-123" });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [MailerService],
    }).compile();

    service = module.get<MailerService>(MailerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendMail", () => {
    it("should send email with correct options", async () => {
      const result = await service.sendMail({
        to: "user@example.com",
        subject: "Test Subject",
        html: "<p>Test HTML</p>",
        text: "Test Text",
      });

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@example.com",
          subject: "Test Subject",
          html: "<p>Test HTML</p>",
          text: "Test Text",
        }),
      );
      expect(result).toEqual({ messageId: "mock-message-id-123" });
    });

    it("should throw error if transporter fails", async () => {
      sendMailMock.mockRejectedValue(new Error("SMTP Connection Failed"));

      await expect(
        service.sendMail({
          to: "fail@example.com",
          subject: "Fail",
          html: "<p>Fail</p>",
        }),
      ).rejects.toThrow("SMTP Connection Failed");
    });
  });

  describe("sendPasswordResetEmail", () => {
    it("should generate proper HTML and send reset password email", async () => {
      const result = await service.sendPasswordResetEmail(
        "personal@example.com",
        "Carlos Trainer",
        "secret-reset-token-456",
      );

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const callArg = sendMailMock.mock.calls[0][0];

      expect(callArg.to).toBe("personal@example.com");
      expect(callArg.subject).toBe("Recuperação de Senha - viviOps");
      expect(callArg.html).toContain("Carlos Trainer");
      expect(callArg.html).toContain("secret-reset-token-456");
      expect(callArg.html).toContain("60 minutos");
      expect(callArg.text).toContain("secret-reset-token-456");
      expect(result).toEqual({ messageId: "mock-message-id-123" });
    });
  });
});
