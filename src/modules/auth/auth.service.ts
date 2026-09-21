import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";

import { UsersService } from "../users/users.service";
import { PrismaService } from "../prisma/prisma.service";
import { MailerService } from "../mailer/mailer.service";
import { ResetPasswordDto } from "./dto/reset-password.dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mailerService: MailerService,
  ) {}

  // Valida usuário (email/senha)
  async validateUser(email: string, pass: string): Promise<any> {
    if (!email || !pass) return null;
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.usersService.findByEmailForAuth(normalizedEmail);

    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    const payload = { username: user.name, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar || null,
        tenant: user.tenant || null,
      },
    };
  }

  async requestPasswordReset(email: string) {
    const genericResponse = {
      message:
        "Se o e-mail existir em nossa base, um link de recuperação será enviado.",
    };

    if (!email) {
      return genericResponse;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      });

      if (!user) {
        this.logger.log(`Password reset requested for non-existing email: ${email}`);
        return genericResponse;
      }

      // Generate random secure token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate previous active tokens for this user
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, used: false },
        data: { used: true },
      });

      // Save new reset token
      await this.prisma.passwordResetToken.create({
        data: {
          token,
          userId: user.id,
          expiresAt,
          used: false,
        },
      });

      // Dispatch email via Mailpit / SMTP
      await this.mailerService.sendPasswordResetEmail(user.email, user.name, token);

      return genericResponse;
    } catch (error: any) {
      this.logger.error(`Error in requestPasswordReset for ${email}: ${error.message}`, error.stack);
      // For security and UX, still return generic message but log failure
      return genericResponse;
    }
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { token, password } = dto;

    const resetTokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetTokenRecord) {
      throw new BadRequestException("Token de recuperação inválido ou expirado.");
    }

    if (resetTokenRecord.used) {
      throw new BadRequestException("Este token de recuperação já foi utilizado.");
    }

    if (new Date() > resetTokenRecord.expiresAt) {
      throw new BadRequestException("Este token de recuperação expirou.");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password and mark token as used
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetTokenRecord.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetTokenRecord.id },
        data: { used: true },
      }),
    ]);

    return {
      message: "Senha redefinida com sucesso. Você já pode fazer login.",
    };
  }
}

