import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import request from "supertest";
import {
  PORTAL_TOKEN_AUDIENCE,
  RolesGuard,
  SESSION_TOKEN_AUDIENCE,
} from "../../common/auth";
import { AdminUsersController } from "./admin/admin-users.controller";
import { AdminUsersService } from "./admin/admin-users.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { JwtStrategy, passwordFingerprint } from "./jwt.strategy";
import { SettingsController } from "./settings/settings.controller";
import { SettingsService } from "./settings/settings.service";
import { UsersController } from "./users/users.controller";
import { UsersService } from "./users/users.service";

const SECRET = "identity-http-spec-secret";
const HASH = "$2b$10$hashedpassword";
const SESSION = { audience: SESSION_TOKEN_AUDIENCE };
const ACCOUNTS: Record<string, object> = {
  t1: { id: "t1", name: "Tina", role: "trainer", status: "ACTIVE" },
  a1: { id: "a1", name: "Adam", role: "admin", status: "ACTIVE" },
};

/**
 * Routing, guards and body validation of the identity controllers, over HTTP,
 * with the real JwtStrategy / RolesGuard / ValidationPipe and mocked services.
 */
describe("identity over HTTP", () => {
  let app: INestApplication;
  let trainerToken: string;
  let adminToken: string;
  let jwt: JwtService;

  const authService = {
    login: jest.fn(),
    signup: jest.fn(),
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
  };
  const usersService = {
    findSessionAccount: jest.fn(),
    findOne: jest.fn(),
    updateProfile: jest.fn(),
    generateAvatarUploadUrl: jest.fn(),
    updateBranding: jest.fn(),
    completeSetup: jest.fn(),
  };
  const settingsService = {
    getLanguage: jest.fn(),
    updateLanguage: jest.fn(),
    updateWorkHours: jest.fn(),
    updateDnd: jest.fn(),
  };
  const adminUsersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [
        AuthController,
        UsersController,
        SettingsController,
        AdminUsersController,
      ],
      providers: [
        JwtStrategy,
        RolesGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === "JWT_SECRET" ? SECRET : undefined),
          },
        },
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
        { provide: SettingsService, useValue: settingsService },
        { provide: AdminUsersService, useValue: adminUsersService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    jwt = module.get(JwtService);
    trainerToken = sessionToken({ sub: "t1", role: "trainer" });
    adminToken = sessionToken({ sub: "a1", role: "admin" });
  });

  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    usersService.findSessionAccount.mockImplementation(async (id: string) =>
      ACCOUNTS[id] ? { ...ACCOUNTS[id], password: HASH } : null,
    );
  });

  const sessionToken = (claims: Record<string, unknown>) =>
    jwt.sign(
      { username: "x", pwd: passwordFingerprint(HASH), ...claims },
      SESSION,
    );

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe("auth", () => {
    it("POST /auth/login answers 200 and passes the credentials on", async () => {
      authService.login.mockResolvedValue({ accessToken: "t" });

      await http()
        .post("/api/auth/login")
        .send({ email: "a@b.com", password: "segredo" })
        .expect(200, { accessToken: "t" });
      expect(authService.login).toHaveBeenCalledWith("a@b.com", "segredo");
    });

    it.each(["/api/auth/signup", "/api/auth/register"])(
      "POST %s answers 201 through the same handler",
      async (path) => {
        const body = { name: "Ana", email: "ana@x.com", password: "segredo" };
        authService.signup.mockResolvedValue({ accessToken: "t" });

        await http().post(path).send(body).expect(201, { accessToken: "t" });
        expect(authService.signup).toHaveBeenCalledWith(body);
      },
    );

    it.each(["/api/auth/signup", "/api/auth/register"])(
      "POST %s rejects a role with 400 and creates nothing",
      async (path) => {
        const response = await http().post(path).send({
          name: "Eve",
          email: "eve@x.com",
          password: "segredo",
          role: "admin",
        });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain(
          "property role should not exist",
        );
        expect(authService.signup).not.toHaveBeenCalled();
      },
    );

    it.each(["/api/auth/me", "/api/users/me"])(
      "GET %s returns the caller's profile through the same handler",
      async (path) => {
        usersService.findOne.mockResolvedValue({ id: "t1" });

        await http()
          .get(path)
          .set(bearer(trainerToken))
          .expect(200, { id: "t1" });
        expect(usersService.findOne).toHaveBeenCalledWith("t1");
      },
    );

    it.each(["/api/auth/me", "/api/users/me"])(
      "GET %s answers 401 without a token",
      async (path) => {
        await http().get(path).expect(401);
        expect(usersService.findOne).not.toHaveBeenCalled();
      },
    );

    it.each(["/api/auth/forgot-password", "/api/auth/password-reset/request"])(
      "POST %s answers 200 through the same handler",
      async (path) => {
        authService.requestPasswordReset.mockResolvedValue({ message: "ok" });

        await http().post(path).send({ email: "a@b.com" }).expect(200);
        expect(authService.requestPasswordReset).toHaveBeenCalledWith(
          "a@b.com",
        );
      },
    );

    it.each(["/api/auth/reset-password", "/api/auth/password-reset/confirm"])(
      "POST %s answers 200 through the same handler, and 400 for a short password",
      async (path) => {
        authService.resetPassword.mockResolvedValue({ message: "ok" });
        const body = { token: "tok", password: "12345678" };

        await http().post(path).send(body).expect(200);
        expect(authService.resetPassword).toHaveBeenCalledWith(body);

        await http()
          .post(path)
          .send({ token: "tok", password: "1234567" })
          .expect(400);
      },
    );

    it("POST /auth/logout needs the bearer token", async () => {
      await http().post("/api/auth/logout").expect(401);
      await http()
        .post("/api/auth/logout")
        .set(bearer(trainerToken))
        .expect(200);
    });

    it("rejects a token signed with another secret", async () => {
      const forged = new JwtService({ secret: "other" }).sign({
        sub: "x",
        username: "x",
        role: "admin",
      });
      await http().get("/api/auth/me").set(bearer(forged)).expect(401);
    });

    it("rejects a correctly signed token that has no audience", async () => {
      const token = jwt.sign({
        sub: "t1",
        username: "Tina",
        role: "trainer",
        pwd: passwordFingerprint(HASH),
      });

      await http().get("/api/auth/me").set(bearer(token)).expect(401);
      expect(usersService.findOne).not.toHaveBeenCalled();
    });

    it("rejects a student-portal token (portal audience) as a session", async () => {
      const portal = jwt.sign(
        { sub: "c1", clientId: "c1", userId: "t1", action: "WORKOUT" },
        { audience: PORTAL_TOKEN_AUDIENCE },
      );

      await http().get("/api/auth/me").set(bearer(portal)).expect(401);
      expect(usersService.findSessionAccount).not.toHaveBeenCalled();
    });

    it("rejects a session-audience token that carries `action` or no trainer/admin role", async () => {
      const withAction = sessionToken({
        sub: "t1",
        role: "trainer",
        action: "WORKOUT",
      });
      const noRole = sessionToken({ sub: "t1" });

      await http().get("/api/auth/me").set(bearer(withAction)).expect(401);
      await http().get("/api/auth/me").set(bearer(noRole)).expect(401);
      expect(usersService.findSessionAccount).not.toHaveBeenCalled();
    });

    it("rejects the token of an account that was deleted or blocked", async () => {
      usersService.findSessionAccount.mockResolvedValueOnce(null);
      await http().get("/api/auth/me").set(bearer(trainerToken)).expect(401);

      usersService.findSessionAccount.mockResolvedValueOnce({
        ...ACCOUNTS.t1,
        status: "BLOCKED",
        password: HASH,
      });
      await http().get("/api/auth/me").set(bearer(trainerToken)).expect(401);
      expect(usersService.findOne).not.toHaveBeenCalled();
    });

    it("rejects a token issued before the password changed", async () => {
      usersService.findSessionAccount.mockResolvedValueOnce({
        ...ACCOUNTS.t1,
        password: "$2b$10$newhash",
      });

      await http().get("/api/auth/me").set(bearer(trainerToken)).expect(401);
    });

    it("POST /auth/refresh does not exist (404)", async () => {
      await http().post("/api/auth/refresh").expect(404);
    });
  });

  describe("users", () => {
    it("PATCH /users/profile rejects a role with 400", async () => {
      const response = await http()
        .patch("/api/users/profile")
        .set(bearer(trainerToken))
        .send({ name: "Tina", role: "admin" });

      expect(response.status).toBe(400);
      expect(usersService.updateProfile).not.toHaveBeenCalled();
    });

    it("PATCH /users/profile accepts a slug and updates the caller only", async () => {
      usersService.updateProfile.mockResolvedValue({ id: "t1" });

      await http()
        .patch("/api/users/profile")
        .set(bearer(trainerToken))
        .send({ slug: "tina-fit" })
        .expect(200);
      expect(usersService.updateProfile).toHaveBeenCalledWith("t1", {
        slug: "tina-fit",
      });
    });

    it("the old unguarded user routes are gone", async () => {
      await http().get("/api/users").set(bearer(adminToken)).expect(404);
      await http()
        .post("/api/users")
        .send({ name: "x", email: "x@x.com", password: "segredo" })
        .expect(404);
      await http().delete("/api/users/t1").set(bearer(adminToken)).expect(404);
    });

    it("POST /users/setup/complete answers 200, PATCH /users/branding validates the colour", async () => {
      usersService.completeSetup.mockResolvedValue({ success: true, user: {} });
      await http()
        .post("/api/users/setup/complete")
        .set(bearer(trainerToken))
        .expect(200);

      await http()
        .patch("/api/users/branding")
        .set(bearer(trainerToken))
        .send({ primaryColor: "green" })
        .expect(400);
    });

    it.each([
      ["patch", "/api/users/profile"],
      ["post", "/api/users/avatar-upload-url"],
      ["patch", "/api/users/branding"],
      ["post", "/api/users/setup/complete"],
      ["get", "/api/settings/language"],
      ["patch", "/api/settings/dnd"],
    ] as const)("%s %s answers 401 without a token", async (method, path) => {
      await http()[method](path).expect(401);
    });
  });

  describe("settings", () => {
    it("PATCH /settings/dnd takes the new key names and rejects the old ones", async () => {
      settingsService.updateDnd.mockResolvedValue({ enabled: false });

      await http()
        .patch("/api/settings/dnd")
        .set(bearer(trainerToken))
        .send({ enabled: false, startHour: 23 })
        .expect(200);
      expect(settingsService.updateDnd).toHaveBeenCalledWith("t1", {
        enabled: false,
        startHour: 23,
      });

      await http()
        .patch("/api/settings/dnd")
        .set(bearer(trainerToken))
        .send({ dndEnabled: false })
        .expect(400);
    });

    it("PUT /settings/work-hours rejects a time that is not HH:mm", async () => {
      const day = { enabled: true, start: "07:00", end: "19:00" };
      const week = {
        monday: { ...day, start: "7h" },
        tuesday: day,
        wednesday: day,
        thursday: day,
        friday: day,
        saturday: day,
        sunday: day,
        slotDurationMinutes: 60,
      };

      await http()
        .put("/api/settings/work-hours")
        .set(bearer(trainerToken))
        .send(week)
        .expect(400);
      expect(settingsService.updateWorkHours).not.toHaveBeenCalled();
    });
  });

  describe("admin/users", () => {
    const routes = [
      ["get", "/api/admin/users"],
      ["get", "/api/admin/users/u1"],
      ["patch", "/api/admin/users/u1"],
      ["delete", "/api/admin/users/u1"],
    ] as const;

    it.each(routes)(
      "%s %s answers 401 without a token",
      async (method, path) => {
        await http()[method](path).expect(401);
      },
    );

    it.each(routes)("%s %s answers 403 to a trainer", async (method, path) => {
      await http()[method](path).set(bearer(trainerToken)).expect(403);
    });

    it("answers 403 to a trainer whose token claims the admin role", async () => {
      const forgedRole = sessionToken({ sub: "t1", role: "admin" });

      await http().get("/api/admin/users").set(bearer(forgedRole)).expect(403);
      expect(adminUsersService.findAll).not.toHaveBeenCalled();
    });

    it("never reaches the service for a trainer or an anonymous caller", async () => {
      for (const [method, path] of routes) {
        await http()[method](path).set(bearer(trainerToken));
        await http()[method](path);
      }
      for (const handler of Object.values(adminUsersService)) {
        expect(handler).not.toHaveBeenCalled();
      }
    });

    it("GET /admin/users lists for an admin, with numeric paging", async () => {
      adminUsersService.findAll.mockResolvedValue({ items: [], total: 0 });

      await http()
        .get("/api/admin/users?page=2&limit=10&status=BLOCKED")
        .set(bearer(adminToken))
        .expect(200);
      expect(adminUsersService.findAll).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        status: "BLOCKED",
      });
    });

    it("GET /admin/users rejects an unknown status with 400", async () => {
      await http()
        .get("/api/admin/users?status=GONE")
        .set(bearer(adminToken))
        .expect(400);
    });

    it("PATCH /admin/users/:id accepts status and limits only", async () => {
      adminUsersService.update.mockResolvedValue({ id: "u1" });

      await http()
        .patch("/api/admin/users/u1")
        .set(bearer(adminToken))
        .send({ status: "BLOCKED", limits: { maxStudents: 5 } })
        .expect(200);
      expect(adminUsersService.update).toHaveBeenCalledWith("u1", {
        status: "BLOCKED",
        limits: { maxStudents: 5 },
      });

      await http()
        .patch("/api/admin/users/u1")
        .set(bearer(adminToken))
        .send({ role: "admin" })
        .expect(400);
    });

    it("DELETE /admin/users/:id answers 204 with no body", async () => {
      adminUsersService.remove.mockResolvedValue(undefined);

      const response = await http()
        .delete("/api/admin/users/u1")
        .set(bearer(adminToken));

      expect(response.status).toBe(204);
      expect(response.text).toBe("");
      expect(adminUsersService.remove).toHaveBeenCalledWith("u1");
    });
  });
});
