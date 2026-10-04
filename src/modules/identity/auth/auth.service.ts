import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { User } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  SESSION_TOKEN_AUDIENCE,
} from "../../../common/auth";
import { MailerService } from "../../mailer/mailer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessTokenPayload, passwordFingerprint } from "../jwt.strategy";
import { LoginResponse, toUserView } from "../user-view";
import { SignupDto } from "../users/dto/signup.dto";
import { normalizeEmail, UsersService } from "../users/users.service";
import { ResetPasswordDto } from "./dto/reset-password.dto";

const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/**
 * bcrypt hash (same cost as BCRYPT_ROUNDS) of a random value nobody knows. An
 * unknown e-mail is compared against it so that it costs the same time as a
 * wrong password, and the login cannot be used to find out which e-mails exist.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$10$9Ce15xAMHCo7QLqiTb2F/OXmow.H5MGQW0p4Fs3jpmeG7FgfieXJW";
const FORGOT_PASSWORD_RESPONSE = {
  message:
    "Se o e-mail existir em nossa base, um link de recuperação será enviado.",
};

/** Credentials, access tokens and the password-reset flow. */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly mailerService: MailerService,
  ) {}

  /**
   * @returns The account when the e-mail exists and the password matches, else null
   *
   * @example
   * const user = await authService.validateUser(" Ana@X.com ", "segredo");
   */
  async validateUser(email: string, pass: string): Promise<User | null> {
    if (!email || !pass) return null;
    const user = await this.usersService.findByEmailForAuth(email);
    const matches = await bcrypt.compare(
      pass,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );
    return user && matches ? user : null;
  }

  /**
   * @throws {UnauthorizedException} When the e-mail or the password is wrong
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.validateUser(email, password);
    if (!user) throw new UnauthorizedException("Credenciais inválidas");
    return this.issueToken(user);
  }

  /**
   * Creates the trainer account and signs it in.
   * @throws {ConflictException} When the e-mail is already registered
   */
  async signup(dto: SignupDto): Promise<LoginResponse> {
    return this.issueToken(await this.usersService.create(dto));
  }

  /** Signs an access token for an already authenticated account. */
  issueToken(user: User): LoginResponse {
    const payload: AccessTokenPayload = {
      username: user.name,
      sub: user.id,
      role: user.role,
      pwd: passwordFingerprint(user.password),
    };
    const token = this.jwtService.sign(payload, {
      audience: SESSION_TOKEN_AUDIENCE,
    });
    return {
      access_token: token,
      accessToken: token,
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toUserView(user),
    };
  }

  /**
   * Always answers with the same text, so the endpoint cannot be used to find out
   * which e-mails are registered. A failure (database, SMTP) is logged with its
   * stack and does not change the response (contract 6.1). The e-mail is sent off
   * the request path, so SMTP latency does not tell the two cases apart either.
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    if (!email) return FORGOT_PASSWORD_RESPONSE;
    try {
      await this.sendResetLink(normalizeEmail(email));
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Error in requestPasswordReset for ${email}: ${cause.message}`,
        cause.stack,
      );
    }
    return FORGOT_PASSWORD_RESPONSE;
  }

  private async sendResetLink(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      this.logger.log(`Password reset requested for non-existing email`);
      return;
    }
    const token = randomBytes(32).toString("hex");
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });
    await this.prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        used: false,
      },
    });
    this.deliverResetLink(user, token);
  }

  /** Fire-and-forget: the response never waits for SMTP; a failure is logged, never dropped. */
  private deliverResetLink(user: User, token: string): void {
    Promise.resolve()
      .then(() =>
        this.mailerService.sendPasswordResetEmail(user.email, user.name, token),
      )
      .catch((error: unknown) => {
        const cause = error instanceof Error ? error : new Error(String(error));
        const smtp = error as { code?: unknown; responseCode?: unknown };
        this.logger.error(
          `Password reset e-mail for user ${user.id} was not sent ` +
            `(code=${String(smtp.code ?? "n/a")}, smtp=${String(smtp.responseCode ?? "n/a")}): ${cause.message}`,
          cause.stack,
        );
      });
  }

  /**
   * @throws {BadRequestException} When the token is unknown, already used or expired
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
    });
    if (!record) {
      throw new BadRequestException(
        "Token de recuperação inválido ou expirado.",
      );
    }
    if (record.used) throw tokenAlreadyUsed();
    if (new Date() > record.expiresAt) {
      throw new BadRequestException("Este token de recuperação expirou.");
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      // Atomic claim: of two concurrent requests with the same token, one wins.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, used: false },
        data: { used: true },
      });
      if (claimed.count !== 1) throw tokenAlreadyUsed();
      await tx.user.update({
        where: { id: record.userId },
        data: { password },
      });
    });
    return {
      message: "Senha redefinida com sucesso. Você já pode fazer login.",
    };
  }
}

function tokenAlreadyUsed(): BadRequestException {
  return new BadRequestException("Este token de recuperação já foi utilizado.");
}
