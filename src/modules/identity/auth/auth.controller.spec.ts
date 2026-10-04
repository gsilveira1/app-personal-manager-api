import { UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { UsersService } from "../users/users.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController", () => {
  let controller: AuthController;
  const authService = {
    login: jest.fn(),
    signup: jest.fn(),
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
  };
  const usersService = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();
    controller = module.get(AuthController);
  });

  describe("POST /auth/login", () => {
    it("returns the login response on valid credentials", async () => {
      authService.login.mockResolvedValue({ access_token: "jwt-token" });

      const result = await controller.login({
        email: "joao@test.com",
        password: "senha123",
      });

      expect(authService.login).toHaveBeenCalledWith(
        "joao@test.com",
        "senha123",
      );
      expect(result).toEqual({ access_token: "jwt-token" });
    });

    it("propagates UnauthorizedException on invalid credentials", async () => {
      authService.login.mockRejectedValue(
        new UnauthorizedException("Credenciais inválidas"),
      );

      await expect(
        controller.login({ email: "bad@test.com", password: "wrong1" }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  it("POST /auth/logout returns a success message", () => {
    expect(controller.logout().message).toContain("sucesso");
  });

  it("POST /auth/signup delegates to authService.signup", async () => {
    const body = {
      name: "Maria",
      email: "maria@test.com",
      password: "senha123",
    };
    authService.signup.mockResolvedValue({
      access_token: "t",
      user: { id: "2" },
    });

    const result = await controller.signup(body);

    expect(authService.signup).toHaveBeenCalledWith(body);
    expect(result).toEqual({ access_token: "t", user: { id: "2" } });
  });

  it("GET /auth/me returns the profile of the JWT's user", async () => {
    const user = { id: "1", name: "João", email: "joao@test.com" };
    usersService.findOne.mockResolvedValue(user);

    const result = await controller.getProfile("1");

    expect(usersService.findOne).toHaveBeenCalledWith("1");
    expect(result).toEqual(user);
  });

  it("POST /auth/forgot-password delegates to authService.requestPasswordReset", async () => {
    authService.requestPasswordReset.mockResolvedValue({ message: "Sent" });

    const result = await controller.forgotPassword({ email: "user@test.com" });

    expect(authService.requestPasswordReset).toHaveBeenCalledWith(
      "user@test.com",
    );
    expect(result).toEqual({ message: "Sent" });
  });

  it("POST /auth/reset-password delegates to authService.resetPassword", async () => {
    const body = { token: "tok-123", password: "NewPassword123!" };
    authService.resetPassword.mockResolvedValue({ message: "ok" });

    const result = await controller.resetPassword(body);

    expect(authService.resetPassword).toHaveBeenCalledWith(body);
    expect(result).toEqual({ message: "ok" });
  });
});
