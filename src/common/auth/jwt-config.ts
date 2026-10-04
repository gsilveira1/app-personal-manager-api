import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModuleAsyncOptions } from "@nestjs/jwt";

/** Lifetime of an access token. Returned to clients as `expiresIn`. */
export const ACCESS_TOKEN_TTL_SECONDS = 86_400;

const DEV_JWT_SECRET = "segredo_padrao_dev";
const PRODUCTION = "production";
/** 256 bits of an HS256 key, written as characters. */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * Every default or example secret that ever shipped in this repository
 * (compose files, .env.example, README, test setup). Anyone can read them.
 */
const KNOWN_PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  DEV_JWT_SECRET,
  "seu_segredo_aqui",
  "seu_segredo_super_secreto_aqui",
  "e2e-secret-not-for-production",
]);

/**
 * @returns `JWT_SECRET`, or the development fallback outside production
 * @throws {Error} In production when `JWT_SECRET` is missing, is a known
 *   placeholder, or has fewer than 32 characters. The value is never echoed.
 *
 * @example
 * const secret = resolveJwtSecret(configService);
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>("JWT_SECRET");
  if (config.get<string>("NODE_ENV") !== PRODUCTION) {
    return secret || DEV_JWT_SECRET;
  }
  if (!secret) {
    throw new Error("JWT_SECRET must be set in production");
  }
  if (KNOWN_PLACEHOLDER_SECRETS.has(secret.trim())) {
    throw new Error(
      "JWT_SECRET is a known placeholder value; generate one with `openssl rand -base64 48`",
    );
  }
  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must have at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production (got ${secret.length})`,
    );
  }
  return secret;
}

/**
 * One JwtModule configuration for every module that signs or verifies tokens
 * (identity: access tokens; workouts: student-portal magic links).
 *
 * No default audience on purpose: each signer passes its own (token-audience.ts),
 * so a token signed without one is accepted by no verifier.
 *
 * @example
 * @Module({ imports: [JwtModule.registerAsync(jwtModuleAsyncOptions)] })
 */
export const jwtModuleAsyncOptions: JwtModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: resolveJwtSecret(config),
    signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  }),
};
