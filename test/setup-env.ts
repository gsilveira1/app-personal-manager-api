/**
 * Runs before every e2e file, before the application (and dotenv) is loaded.
 *
 * The suites write to PostgreSQL and Redis, so they must never fall back to the
 * developer's `.env`: the connection strings have to be passed on the command line
 * and the database must be recognisably disposable.
 *
 *   DATABASE_URL=postgresql://integ:integ@127.0.0.1:55432/vivi_integ \
 *   REDIS_URL=redis://127.0.0.1:56379 npm run test:e2e
 *
 * Variables already defined win over `.env` (dotenv never overrides), so everything
 * that could reach an external service is pinned here as well.
 */
const DISPOSABLE_DATABASE = /(integ|test|e2e)/i;

function requireExplicit(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `e2e: ${name} must be set explicitly on the command line (the suites never read it from .env).`,
    );
  }
  return value;
}

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

const databaseUrl = requireExplicit("DATABASE_URL");
requireExplicit("REDIS_URL");

if (!DISPOSABLE_DATABASE.test(databaseName(databaseUrl))) {
  throw new Error(
    `e2e: refusing to run against database "${databaseName(databaseUrl)}": its name must contain "integ", "test" or "e2e".`,
  );
}

const PINNED: Record<string, string> = {
  NODE_ENV: "test",
  JWT_SECRET: "e2e-secret-not-for-production",
  FRONTEND_URL: "http://localhost:5173",
  // Empty = "not configured": the real Evolution API can never be called.
  EVOLUTION_API_URL: "",
  EVOLUTION_API_KEY: "",
  // Nothing listens here; MailerService is replaced by a stub anyway.
  EMAIL_SMTP_HOST: "127.0.0.1",
  EMAIL_SMTP_PORT: "9",
  GCP_PROJECT_ID: "e2e",
  GCP_CLIENT_EMAIL: "e2e@example.invalid",
  GCP_PRIVATE_KEY: "e2e",
  GCS_BUCKET_NAME: "e2e",
  GEMINI_API_KEY: "",
};

for (const [name, value] of Object.entries(PINNED)) {
  process.env[name] = value;
}
