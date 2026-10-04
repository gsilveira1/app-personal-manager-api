/** The subset of nodemailer's SMTP transport options this application sets. */
export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  ignoreTLS?: true;
  auth?: { user: string; pass: string };
}

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_HOST = "localhost";
/** Mailpit. */
const DEFAULT_PORT = 1025;
const IMPLICIT_TLS_PORT = 465;

function parseSecure(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`EMAIL_SMTP_SECURE must be "true" or "false", got "${raw}"`);
}

function parseAuth(env: Env): SmtpOptions["auth"] {
  const user = env.EMAIL_SMTP_USER;
  const pass = env.EMAIL_SMTP_PASSWORD;
  if (!user && !pass) return undefined;
  if (!user || !pass) {
    throw new Error(
      "EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must be set together",
    );
  }
  return { user, pass };
}

/**
 * SMTP transport options from the environment.
 *
 * - `EMAIL_SMTP_SECURE` ("true" | "false"): implicit TLS. Default: true in
 *   production on port 465, false otherwise (STARTTLS is then negotiated).
 * - `EMAIL_SMTP_USER` + `EMAIL_SMTP_PASSWORD`: SMTP auth, both or neither.
 * - `ignoreTLS` (never upgrade to TLS) is set only outside production, without
 *   credentials and without `EMAIL_SMTP_SECURE=true`: the local Mailpit setup.
 *
 * @throws {Error} On an invalid EMAIL_SMTP_SECURE or half-configured credentials
 *
 * @example
 * buildSmtpOptions({ NODE_ENV: "development" })
 * // { host: "localhost", port: 1025, secure: false, ignoreTLS: true }
 */
export function buildSmtpOptions(env: Env): SmtpOptions {
  const isProduction = env.NODE_ENV === "production";
  const port = Number(env.EMAIL_SMTP_PORT) || DEFAULT_PORT;
  const explicitSecure = parseSecure(env.EMAIL_SMTP_SECURE);
  const secure = explicitSecure ?? (isProduction && port === IMPLICIT_TLS_PORT);
  const auth = parseAuth(env);
  const plaintextAllowed = !isProduction && !secure && !auth;

  return {
    host: env.EMAIL_SMTP_HOST || DEFAULT_HOST,
    port,
    secure,
    ...(plaintextAllowed ? { ignoreTLS: true as const } : {}),
    ...(auth ? { auth } : {}),
  };
}
