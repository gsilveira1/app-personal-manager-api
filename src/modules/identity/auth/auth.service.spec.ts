import {
  BadRequestException,
  ConflictException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import { MailerService } from "../../mailer/mailer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { passwordFingerprint } from "../jwt.strategy";
import { buildUser } from "../testing";
import { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";

jest.mock("bcrypt");

describe("AuthService", () => {
  let service: AuthService;
  let usersService: { findByEmailForAuth: jest.Mock; create: jest.Mock };
  let jwtService: { sign: jest.Mock };
  let tx: {
    user: { update: jest.Mock };
    passwordResetToken: { updateMany: jest.Mock };
  };
  let prisma: any;
  let mailerService: { sendPasswordResetEmail: jest.Mock };
  let errorLog: jest.SpyInstance;

  const mockUser = buildUser();

  beforeEach(async () => {
    usersService = { findByEmailForAuth: jest.fn(), create: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue("jwt-token-123") };
    tx = {
      user: { update: jest.fn() },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      user: { findUnique: jest.fn() },
      passwordResetToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((run) => run(tx)),
    };
    mailerService = {
      sendPasswordResetEmail: jest
        .fn()
        .mockResolvedValue({ messageId: "msg-123" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailerService },
      ],
    }).compile();
    service = module.get(AuthService);

    errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("validateUser", () => {
    it("returns the user when the credentials are valid", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser("joao@example.com", "senha123");

      expect(usersService.findByEmailForAuth).toHaveBeenCalledWith(
        "joao@example.com",
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        "senha123",
        "$2b$10$hashedpassword",
      );
      expect(result).toBe(mockUser);
    });

    it("returns null when the email does not exist", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser("nobody@example.com", "senha123"),
      ).resolves.toBeNull();
    });

    it("runs bcrypt against a dummy hash of the same cost for an unknown e-mail (no timing oracle)", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await service.validateUser("nobody@example.com", "senha123");

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        "senha123",
        expect.stringMatching(/^\$2b\$10\$[./A-Za-z0-9]{53}$/),
      );
    });

    it("returns null for an unknown e-mail even if the dummy hash were to match", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.validateUser("nobody@example.com", "senha123"),
      ).resolves.toBeNull();
    });

    it("returns null when the password is wrong", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser("joao@example.com", "wrongpassword"),
      ).resolves.toBeNull();
    });

    it("returns null without querying when email or password is empty", async () => {
      await expect(service.validateUser("", "senha123")).resolves.toBeNull();
      await expect(service.validateUser("a@b.com", "")).resolves.toBeNull();
      expect(usersService.findByEmailForAuth).not.toHaveBeenCalled();
    });

    it("propagates a bcrypt failure instead of treating it as a wrong password", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockRejectedValue(
        new Error("bcrypt error"),
      );

      await expect(
        service.validateUser("joao@example.com", "senha123"),
      ).rejects.toThrow("bcrypt error");
    });
  });

  describe("login", () => {
    it("returns the token under both names, its type and lifetime, and the user view", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login("joao@example.com", "senha123");

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          username: "João Silva",
          sub: "user-uuid-1",
          role: "trainer",
          pwd: passwordFingerprint("$2b$10$hashedpassword"),
        },
        { audience: "vivi:session" },
      );
      expect(result.access_token).toBe("jwt-token-123");
      expect(result.accessToken).toBe("jwt-token-123");
      expect(result.tokenType).toBe("Bearer");
      expect(result.expiresIn).toBe(86_400);
      expect(result.user).toMatchObject({
        id: "user-uuid-1",
        name: "João Silva",
        email: "joao@example.com",
        role: "trainer",
        slug: "joao-silva",
        setupCompleted: false,
      });
    });

    it("never returns the password hash or a tenant", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login("joao@example.com", "senha123");

      expect(JSON.stringify(result)).not.toContain("hashedpassword");
      expect(result.user).not.toHaveProperty("password");
      expect(result.user).not.toHaveProperty("tenant");
    });

    it("throws UnauthorizedException on invalid credentials and signs nothing", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(null);

      await expect(service.login("bad@test.com", "wrong1")).rejects.toThrow(
        new UnauthorizedException("Credenciais inválidas"),
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it("still answers a BLOCKED trainer's login (JwtStrategy rejects the token on use)", async () => {
      usersService.findByEmailForAuth.mockResolvedValue(
        buildUser({ status: "BLOCKED" }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login("joao@example.com", "senha123");

      expect(result.user.status).toBe("BLOCKED");
    });
  });

  describe("signup", () => {
    it("creates the account and returns a LoginResponse", async () => {
      usersService.create.mockResolvedValue(mockUser);
      const dto = {
        name: "João Silva",
        email: "joao@example.com",
        password: "senha123",
      };

      const result = await service.signup(dto);

      expect(usersService.create).toHaveBeenCalledWith(dto);
      expect(result.access_token).toBe("jwt-token-123");
      expect(result.accessToken).toBe("jwt-token-123");
      expect(result.user.id).toBe("user-uuid-1");
      expect(result.user).not.toHaveProperty("password");
    });

    it("propagates the 409 of an e-mail in use and signs nothing", async () => {
      usersService.create.mockRejectedValue(new ConflictException("em uso"));

      await expect(
        service.signup({ name: "x", email: "a@b.com", password: "senha123" }),
      ).rejects.toThrow(ConflictException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe("requestPasswordReset", () => {
    it("generates a token, invalidates the previous ones and sends the email when the user exists", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.passwordResetToken.create.mockResolvedValue({ id: "tok-1" });

      const result = await service.requestPasswordReset(" Joao@Example.com ");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "joao@example.com" },
      });
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-uuid-1", used: false },
        data: { used: true },
      });
      const created = prisma.passwordResetToken.create.mock.calls[0][0].data;
      expect(created.token).toMatch(/^[0-9a-f]{64}$/);
      expect(created.userId).toBe("user-uuid-1");
      expect(created.used).toBe(false);
      const ttlMs = created.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(59 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(mailerService.sendPasswordResetEmail).toHaveBeenCalledWith(
        "joao@example.com",
        "João Silva",
        created.token,
      );
      expect(result.message).toContain("Se o e-mail existir");
    });

    it("returns the generic message without sending an email when the user is not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.requestPasswordReset("nobody@example.com");

      expect(mailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(result.message).toContain("Se o e-mail existir");
    });

    it("answers with the same text whether or not the e-mail exists", async () => {
      prisma.user.findUnique.mockResolvedValueOnce(mockUser);
      const known = await service.requestPasswordReset("joao@example.com");
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknown = await service.requestPasswordReset("nobody@example.com");

      expect(known).toEqual(unknown);
    });

    it("answers before the mailer finishes (SMTP latency is not an existence oracle)", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      let delivered = false;
      let finishDelivery: () => void = () => undefined;
      mailerService.sendPasswordResetEmail.mockReturnValue(
        new Promise<void>((resolve) => {
          finishDelivery = () => {
            delivered = true;
            resolve();
          };
        }),
      );

      const result = await service.requestPasswordReset("joao@example.com");

      expect(result.message).toContain("Se o e-mail existir");
      expect(mailerService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(delivered).toBe(false);
      finishDelivery();
    });

    it("keeps the generic response when the mailer fails, and logs the failure with its stack", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const failure = Object.assign(new Error("SMTP 554 rejected"), {
        responseCode: 554,
      });
      mailerService.sendPasswordResetEmail.mockRejectedValue(failure);

      const result = await service.requestPasswordReset("joao@example.com");
      await new Promise(setImmediate);

      expect(result.message).toContain("Se o e-mail existir");
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain("SMTP 554 rejected");
      expect(errorLog.mock.calls[0][0]).toContain("user-uuid-1");
      expect(errorLog.mock.calls[0][0]).toContain("554");
      expect(errorLog.mock.calls[0][1]).toBe(failure.stack);
    });

    it("logs a mailer that throws synchronously instead of failing the request", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mailerService.sendPasswordResetEmail.mockImplementation(() => {
        throw new Error("transport not configured");
      });

      const result = await service.requestPasswordReset("joao@example.com");
      await new Promise(setImmediate);

      expect(result.message).toContain("Se o e-mail existir");
      expect(errorLog.mock.calls[0][0]).toContain("transport not configured");
    });

    it("logs a database failure too", async () => {
      prisma.user.findUnique.mockRejectedValue(new Error("connection lost"));

      await service.requestPasswordReset("joao@example.com");

      expect(errorLog.mock.calls[0][0]).toContain("connection lost");
    });
  });

  describe("resetPassword", () => {
    const dto = { token: "tok-123", password: "NewPassword123!" };
    const record = {
      id: "prt-1",
      token: "tok-123",
      userId: "user-uuid-1",
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it("throws BadRequestException if the token is not found", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toThrow(
        new BadRequestException("Token de recuperação inválido ou expirado."),
      );
    });

    it("throws BadRequestException if the token has already been used", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...record,
        used: true,
      });

      await expect(service.resetPassword(dto)).rejects.toThrow(
        new BadRequestException("Este token de recuperação já foi utilizado."),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("throws BadRequestException if the token has expired", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...record,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.resetPassword(dto)).rejects.toThrow(
        new BadRequestException("Este token de recuperação expirou."),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("stores the bcrypt hash and marks the token as used when the token is valid", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$10$newhash");

      const result = await service.resetPassword(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith("NewPassword123!", 10);
      expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: "prt-1", used: false },
        data: { used: true },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        data: { password: "$2b$10$newhash" },
      });
      expect(result.message).toContain("Senha redefinida com sucesso");
    });

    it("lets only one of two concurrent requests use the token", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);
      tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.resetPassword(dto)).rejects.toThrow(
        new BadRequestException("Este token de recuperação já foi utilizado."),
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });
});
