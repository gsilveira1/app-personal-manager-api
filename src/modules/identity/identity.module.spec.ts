import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { ACCESS_TOKEN_TTL_SECONDS } from "../../common/auth";
import { CLIENT_DIRECTORY, USER_DIRECTORY } from "../../common/ports";
import { GcsService } from "../gcs/gcs.service";
import { MailerService } from "../mailer/mailer.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminUsersController } from "./admin/admin-users.controller";
import { AuthController } from "./auth/auth.controller";
import { IdentityModule } from "./identity.module";
import { JwtStrategy } from "./jwt.strategy";
import { SettingsController } from "./settings/settings.controller";
import { UserDirectoryService } from "./user-directory.service";
import { UsersController } from "./users/users.controller";

const config = {
  get: (key: string) =>
    key === "JWT_SECRET" ? "module-spec-secret" : undefined,
};

/** Stands in for the global PrismaModule, GcsModule and ConfigModule of AppModule. */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: GcsService, useValue: {} },
    { provide: ConfigService, useValue: config },
  ],
  exports: [PrismaService, GcsService, ConfigService],
})
class GlobalInfrastructureStub {}

describe("IdentityModule wiring", () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalInfrastructureStub, IdentityModule],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(MailerService)
      .useValue({ sendPasswordResetEmail: jest.fn() })
      .overrideProvider(CLIENT_DIRECTORY)
      .useValue({ countByOwners: jest.fn() })
      .compile();
  });

  afterAll(() => module.close());

  it("resolves every controller (no missing provider)", () => {
    for (const controller of [
      AuthController,
      UsersController,
      SettingsController,
      AdminUsersController,
    ]) {
      expect(module.get(controller, { strict: false })).toBeInstanceOf(
        controller,
      );
    }
  });

  it("provides USER_DIRECTORY with all five port methods", () => {
    const directory = module.get(USER_DIRECTORY, { strict: false });

    expect(directory).toBeInstanceOf(UserDirectoryService);
    for (const method of [
      "requireBySlug",
      "getProfile",
      "getSettings",
      "getWhatsappConnection",
      "setWhatsappConnection",
    ]) {
      expect(typeof directory[method]).toBe("function");
    }
  });

  it("exports USER_DIRECTORY and nothing else", () => {
    expect(Reflect.getMetadata("exports", IdentityModule)).toEqual([
      USER_DIRECTORY,
    ]);
  });

  it("registers the passport jwt strategy", () => {
    expect(module.get(JwtStrategy, { strict: false })).toBeInstanceOf(
      JwtStrategy,
    );
  });

  it("signs access tokens that last 24 hours", () => {
    const jwt = module.get(JwtService, { strict: false });
    const { iat, exp } = jwt.decode(jwt.sign({ sub: "u1" })) as {
      iat: number;
      exp: number;
    };
    expect(exp - iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });
});
