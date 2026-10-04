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
      // The web app uses path routes (BrowserRouter): no "/#/" in the link.
      expect(callArg.text).toContain(
        "/reset-password?token=secret-reset-token-456",
      );
      expect(callArg.text).not.toContain("/#/");
      expect(result).toEqual({ messageId: "mock-message-id-123" });
    });

    it("escapes the name in the HTML body (review L8)", async () => {
      await service.sendPasswordResetEmail(
        "personal@example.com",
        `<img src=x onerror="alert(1)">`,
        "token-1",
      );

      const { html, text } = sendMailMock.mock.calls[0][0];
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      // The plain-text part is not HTML: it carries the name as typed.
      expect(text).toContain(`<img src=x onerror="alert(1)">`);
    });

    it("escapes and URL-encodes the token in the reset link (review L8)", async () => {
      await service.sendPasswordResetEmail(
        "personal@example.com",
        "Carlos",
        `abc"><script>alert(1)</script>`,
      );

      const { html } = sendMailMock.mock.calls[0][0];
      expect(html).not.toContain("<script>");
      expect(html).not.toContain(`abc">`);
    });
  });

  describe("transport (review L8)", () => {
    const originalEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("builds the transport from the SMTP environment", () => {
      process.env.NODE_ENV = "production";
      process.env.EMAIL_SMTP_HOST = "smtp.example.com";
      process.env.EMAIL_SMTP_PORT = "587";
      process.env.EMAIL_SMTP_USER = "mailer";
      process.env.EMAIL_SMTP_PASSWORD = "s3cret";
      delete process.env.EMAIL_SMTP_SECURE;

      new MailerService();

      expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "mailer", pass: "s3cret" },
      });
    });
  });
});
