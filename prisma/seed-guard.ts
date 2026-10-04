/**
 * Production guards of the database scripts (prisma/seed.ts, prisma/reset.ts).
 * Pure functions over the environment: they run before any connection is opened.
 */
export type ScriptEnv = Readonly<Record<string, string | undefined>>;

const PRODUCTION = "production";
/** Password of the demo accounts outside production. Public knowledge. */
export const DEMO_PASSWORD = "admin123";
export const MIN_PRODUCTION_SEED_PASSWORD_LENGTH = 12;

const isProduction = (env: ScriptEnv): boolean => env.NODE_ENV === PRODUCTION;

/**
 * @throws {Error} When NODE_ENV=production and SEED_ALLOW_PRODUCTION is not the literal "true"
 *
 * @example
 * assertSeedAllowed(process.env);
 */
export function assertSeedAllowed(env: ScriptEnv): void {
  if (isProduction(env) && env.SEED_ALLOW_PRODUCTION !== "true") {
    throw new Error(
      "Refusing to seed: NODE_ENV=production. The seed creates demo accounts and deletes the rows they own. " +
        "Set SEED_ALLOW_PRODUCTION=true (and SEED_ADMIN_PASSWORD) only if that is really intended.",
    );
  }
}

/**
 * @returns The password given to accounts the seed creates
 * @throws {Error} In production when SEED_ADMIN_PASSWORD is missing, is the demo
 *   password or is shorter than 12 characters (the value is never echoed)
 *
 * @example
 * const password = resolveSeedPassword(process.env);
 */
export function resolveSeedPassword(env: ScriptEnv): string {
  const password = env.SEED_ADMIN_PASSWORD;
  if (!isProduction(env)) return password || DEMO_PASSWORD;
  if (
    !password ||
    password === DEMO_PASSWORD ||
    password.length < MIN_PRODUCTION_SEED_PASSWORD_LENGTH
  ) {
    throw new Error(
      `SEED_ADMIN_PASSWORD is required to seed in production: at least ${MIN_PRODUCTION_SEED_PASSWORD_LENGTH} characters, not the demo password. There is no default.`,
    );
  }
  return password;
}

/**
 * The reset truncates every table: never in production, with no override.
 * @throws {Error} When NODE_ENV=production
 *
 * @example
 * assertResetAllowed(process.env);
 */
export function assertResetAllowed(env: ScriptEnv): void {
  if (isProduction(env)) {
    throw new Error(
      "Refusing to reset: NODE_ENV=production. prisma/reset.ts truncates every table and has no production override.",
    );
  }
}
