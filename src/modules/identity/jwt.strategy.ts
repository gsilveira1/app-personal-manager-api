import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { AccountStatus } from "@prisma/client";
import { createHash } from "crypto";
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  AuthenticatedUser,
  resolveJwtSecret,
  ROLE_ADMIN,
  ROLE_TRAINER,
  SESSION_TOKEN_AUDIENCE,
} from "../../common/auth";
import { UsersService } from "./users/users.service";

/** Claims of an access token. */
export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: string;
  /** passwordFingerprint() of the hash the account had when the token was signed. */
  pwd: string;
}

const SESSION_ROLES: readonly string[] = [ROLE_ADMIN, ROLE_TRAINER];

/**
 * Account standings that may hold a session. BLOCKED is an admin lock-out.
 * OVERDUE stays signed in: contract A17 makes it lock the student portal only
 * (the trainer still has to reach the app to settle the account).
 */
const SESSION_STATUSES: readonly AccountStatus[] = [
  AccountStatus.ACTIVE,
  AccountStatus.OVERDUE,
];

const FINGERPRINT_LENGTH = 16;

/**
 * Short digest of a bcrypt hash, carried in the access token so that changing
 * the password invalidates every token signed before it (no extra column).
 * The hash embeds a random 128-bit salt, so the digest reveals nothing useful.
 *
 * @example
 * const pwd = passwordFingerprint(user.password);
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256")
    .update(passwordHash)
    .digest("base64url")
    .slice(0, FINGERPRINT_LENGTH);
}

/** Passport "jwt" strategy behind JwtAuthGuard, for every module. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(configService),
      // Tokens for another verifier (student portal) or with no audience are refused.
      audience: SESSION_TOKEN_AUDIENCE,
    });
  }

  /**
   * Runs after the signature, expiry and audience checks. The token only names
   * the account: whether it may act, and with which role, is read from the database.
   *
   * @throws {UnauthorizedException} Not a session payload; account deleted or
   *   blocked; password changed since the token was signed
   */
  async validate(payload: Record<string, unknown>): Promise<AuthenticatedUser> {
    const { sub, role } = payload;
    if (
      "action" in payload ||
      typeof sub !== "string" ||
      typeof role !== "string" ||
      !SESSION_ROLES.includes(role)
    ) {
      throw this.reject("payload is not a trainer/admin session");
    }

    const account = await this.users.findSessionAccount(sub);
    if (!account) throw this.reject(`account ${sub} no longer exists`);
    if (!SESSION_STATUSES.includes(account.status)) {
      throw this.reject(`account ${sub} is ${account.status}`);
    }
    if (!SESSION_ROLES.includes(account.role)) {
      throw this.reject(`account ${sub} has role "${account.role}"`);
    }
    if (payload.pwd !== passwordFingerprint(account.password)) {
      throw this.reject(`password of account ${sub} changed after issue`);
    }
    return { userId: account.id, username: account.name, role: account.role };
  }

  private reject(reason: string): UnauthorizedException {
    this.logger.warn(`Access token rejected: ${reason}`);
    return new UnauthorizedException();
  }
}
