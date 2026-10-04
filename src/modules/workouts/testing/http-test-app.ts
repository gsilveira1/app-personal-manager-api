import {
  INestApplication,
  Injectable,
  ModuleMetadata,
  ValidationPipe,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthenticatedUser } from "../../../common/auth";

/** HTTP-level test harness for controller specs. Not imported by production code. */

const TEST_JWT_SECRET = "http-spec-secret";

/** Stand-in for identity's JwtStrategy: registers the passport "jwt" strategy JwtAuthGuard needs. */
@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: TEST_JWT_SECRET,
    });
  }

  validate(payload: {
    sub: string;
    username: string;
    role: string;
  }): AuthenticatedUser {
    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
    };
  }
}

/** @returns An `Authorization` header value for a trainer access token */
export function bearerFor(userId: string): string {
  const token = new JwtService({ secret: TEST_JWT_SECRET }).sign({
    sub: userId,
    username: `${userId}@example.com`,
    role: "trainer",
  });
  return `Bearer ${token}`;
}

/**
 * Boots the given controllers behind the same ValidationPipe as `main.ts`.
 *
 * @example
 * const app = await createHttpTestApp({ controllers: [AiController], providers: [...] });
 */
export async function createHttpTestApp(
  metadata: Pick<ModuleMetadata, "controllers" | "providers">,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [PassportModule],
    controllers: metadata.controllers,
    providers: [TestJwtStrategy, ...(metadata.providers ?? [])],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}
