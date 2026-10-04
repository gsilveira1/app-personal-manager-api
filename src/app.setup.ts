import { INestApplication, ValidationPipe } from "@nestjs/common";
import { json, NextFunction, Request, Response, urlencoded } from "express";

export const GLOBAL_PREFIX = "api";

/** Every route unless listed below: forms, logins, public and token routes. */
export const DEFAULT_BODY_LIMIT = "100kb";
/**
 * Routes whose body is a document: a workout structure (up to 26 workouts of
 * blocks and exercises) or the AI context (a client, an evaluation and up to
 * 50 archived plans).
 */
export const STRUCTURED_BODY_LIMIT = "1mb";
/**
 * Outside production only: when the GCS upload is not available the dashboard
 * falls back to a base64 data URL of the avatar (a 5 MB image is ~6.7 MB of
 * base64) and sends it in the client / profile PATCH and inside the AI context.
 */
export const DEV_DATA_URL_BODY_LIMIT = "8mb";

type Env = Readonly<Record<string, string | undefined>>;
type Method = "POST" | "PATCH";
interface RouteRule {
  method: Method;
  path: RegExp;
}

const SEGMENT = "[^/]+";
const route = (method: Method, pattern: string): RouteRule => ({
  method,
  path: new RegExp(`^/${GLOBAL_PREFIX}/${pattern}/?$`),
});

const WORKOUT_STRUCTURE_ROUTES: readonly RouteRule[] = [
  route("POST", `clients/${SEGMENT}/workout-sheets`),
  route("PATCH", `workout-sheets/${SEGMENT}`),
  route("POST", "workout-templates"),
];
const AI_ROUTES: readonly RouteRule[] = [
  route("POST", "ai/workout-plan"),
  route("POST", "ai/workout-insights"),
];
const AVATAR_PATCH_ROUTES: readonly RouteRule[] = [
  route("PATCH", `clients/${SEGMENT}`),
  route("PATCH", "users/profile"),
];

function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production";
}

function matches(
  rules: readonly RouteRule[],
  method: string,
  path: string,
): boolean {
  return rules.some((rule) => rule.method === method && rule.path.test(path));
}

/**
 * The JSON body limit of a request. Small by default; larger only for the routes
 * that are known to carry a document.
 *
 * @param path - Request path including the `/api` prefix, without the query string
 *
 * @example
 * bodyLimitFor("POST", "/api/public/vivi/leads", process.env) // "100kb"
 * bodyLimitFor("POST", "/api/workout-templates", process.env) // "1mb"
 */
export function bodyLimitFor(method: string, path: string, env: Env): string {
  const verb = method.toUpperCase();
  const takesDataUrl =
    matches(AI_ROUTES, verb, path) || matches(AVATAR_PATCH_ROUTES, verb, path);
  if (takesDataUrl && !isProduction(env)) return DEV_DATA_URL_BODY_LIMIT;
  if (
    matches(WORKOUT_STRUCTURE_ROUTES, verb, path) ||
    matches(AI_ROUTES, verb, path)
  ) {
    return STRUCTURED_BODY_LIMIT;
  }
  return DEFAULT_BODY_LIMIT;
}

function toOrigin(raw: string, variable: string): string {
  try {
    const { origin } = new URL(raw);
    if (origin !== "null") return origin;
  } catch {
    // Falls through to the error below: the value is reported, not ignored.
  }
  throw new Error(
    `${variable} must contain absolute http(s) URLs, got "${raw}"`,
  );
}

/**
 * The origins allowed to call the API cross-origin: `CORS_ALLOWED_ORIGINS`
 * (comma-separated) plus the origins of `FRONTEND_URL` and `APP_CLIENT_URL`.
 * Outside production, loopback dev servers are allowed on top of this list
 * (see {@link isOriginAllowed}).
 *
 * @throws {Error} When one of the variables holds something that is not a URL (e.g. `*`)
 *
 * @example
 * resolveAllowedOrigins({ FRONTEND_URL: "https://app.example.com/login" })
 * // ["https://app.example.com"]
 */
export function resolveAllowedOrigins(env: Env): string[] {
  const listed = (env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => toOrigin(entry, "CORS_ALLOWED_ORIGINS"));
  const frontends = (["FRONTEND_URL", "APP_CLIENT_URL"] as const).flatMap(
    (name) => (env[name] ? [toOrigin(env[name], name)] : []),
  );
  return [...new Set([...listed, ...frontends])];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackOrigin(origin: string): boolean {
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.origin === origin
  );
}

function isAllowed(
  origin: string,
  allowList: readonly string[],
  env: Env,
): boolean {
  return (
    allowList.includes(origin) ||
    (!isProduction(env) && isLoopbackOrigin(origin))
  );
}

/**
 * @example
 * isOriginAllowed("https://evil.example.com", process.env) // false
 */
export function isOriginAllowed(origin: string, env: Env): boolean {
  return isAllowed(origin, resolveAllowedOrigins(env), env);
}

type Parser = (req: Request, res: Response, next: NextFunction) => void;

/** One JSON parser per limit, chosen per request by {@link bodyLimitFor}. */
function createJsonParser(env: Env): Parser {
  const parsers = new Map<string, Parser>(
    [DEFAULT_BODY_LIMIT, STRUCTURED_BODY_LIMIT, DEV_DATA_URL_BODY_LIMIT].map(
      (limit) => [limit, json({ limit })],
    ),
  );
  // Named like body-parser's own middleware so Nest does not add its default one.
  return function jsonParser(req, res, next) {
    const parse = parsers.get(bodyLimitFor(req.method, req.path, env));
    if (!parse) {
      next(new Error(`No JSON parser for ${req.method} ${req.path}`));
      return;
    }
    parse(req, res, next);
  };
}

/**
 * HTTP configuration of the application: body limits, the `/api` prefix, the
 * global ValidationPipe and CORS. `main.ts` and the e2e suites both call it, so
 * the tests run against the pipeline that is deployed.
 *
 * @throws {Error} When the CORS environment variables are not URLs
 *
 * @example
 * const app = await NestFactory.create(AppModule);
 * configureApp(app);
 */
export function configureApp(app: INestApplication): void {
  const env = process.env;
  const allowList = resolveAllowedOrigins(env);

  app.use(createJsonParser(env));
  app.use(urlencoded({ limit: DEFAULT_BODY_LIMIT, extended: true }));

  app.setGlobalPrefix(GLOBAL_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.enableCors({
    // Requests without an Origin header (curl, same-origin, server-to-server)
    // are not CORS requests; a listed origin is echoed back; any other origin
    // gets no Access-Control-Allow-Origin, so the browser refuses the answer.
    origin: (origin, callback) =>
      callback(null, !origin || isAllowed(origin, allowList, env)),
    methods: "GET,PUT,POST,PATCH,DELETE",
    credentials: false,
    allowedHeaders: "Content-Type, Accept, Authorization",
  });
}
