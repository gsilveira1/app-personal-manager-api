import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    const host = process.env.EMAIL_SMTP_HOST || "localhost";
    const port = Number(process.env.EMAIL_SMTP_PORT) || 1025;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      ignoreTLS: true,
    });
  }

  async sendMail(options: SendMailOptions): Promise<{ messageId: string }> {
    const from = process.env.EMAIL_FROM || "viviOps <noreply@viviops.com>";

    try {
      const info = await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text || "",
        html: options.html,
      });

      this.logger.log(`Email sent successfully to ${options.to} (Message ID: ${info.messageId})`);
      return { messageId: info.messageId };
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${options.to}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async sendPasswordResetEmail(email: string, name: string, token: string): Promise<{ messageId: string }> {
    const baseUrl = process.env.FRONTEND_URL || process.env.APP_CLIENT_URL || "http://localhost:5173";
    const resetUrl = `${baseUrl}/#/reset-password?token=${token}`;

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recuperação de Senha - viviOps</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 28px 32px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">viviOps</h1>
              <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 13px;">Gestão Inteligente para Personal Trainers</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin: 0 0 16px 0;">Olá, ${name || "Personal"}!</h2>
              <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                Recebemos uma solicitação para redefinir a senha da sua conta no <strong>viviOps</strong>. Se você realizou essa solicitação, clique no botão abaixo para cadastrar uma nova senha:
              </p>
              <!-- CTA Button -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" target="_blank" style="background-color: #10b981; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.25);">
                      Redefinir Minha Senha
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 24px 0 0 0;">
                ⚠️ <strong>Atenção:</strong> Este link de recuperação é de uso único e expira em <strong>60 minutos</strong>.
              </p>
              <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 12px 0 0 0;">
                Se você não solicitou a redefinição de senha, nenhuma ação é necessária. Sua senha atual permanecerá segura.
              </p>
              <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 28px 0 20px 0;" />
              <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0; word-break: break-all;">
                Se o botão não funcionar, copie e cole o seguinte link no seu navegador:<br />
                <a href="${resetUrl}" style="color: #10b981; text-decoration: underline;">${resetUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 16px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                © ${new Date().getFullYear()} viviOps. Todos os direitos reservados.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const text = `Olá, ${name || "Personal"}!\n\nRecebemos uma solicitação para redefinir a senha da sua conta no viviOps.\n\nAcesse o link abaixo para redefinir sua senha (válido por 60 minutos):\n${resetUrl}\n\nSe você não solicitou a alteração, desconsidere esta mensagem.`;

    return this.sendMail({
      to: email,
      subject: "Recuperação de Senha - viviOps",
      html,
      text,
    });
  }
}
