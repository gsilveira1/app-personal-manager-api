import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { BadRequestException } from "@nestjs/common";
import * as bcrypt from "bcrypt";

import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";
import { PrismaService } from "../prisma/prisma.service";
import { MailerService } from "../mailer/mailer.service";

jest.mock("bcrypt");

describe("AuthService", () => {
  let service: AuthService;
  let usersService: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;
  let prismaService: any;
  let mailerService: Record<string, jest.Mock>;

  const mockUser = {
    id: "user-uuid-1",
    name: "João Silva",
    email: "joao@example.com",
    password: "$2b$10$hashedpassword",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    usersService = {
      findByEmailForAuth: jest.fn(),
    };
    jwtService = {
      sign: jest.fn(),
    };
    prismaService = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((promises) => Promise.all(promises)),
    };
    mailerService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue({ messageId: "msg-123" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prismaService },
        { provide: MailerService, useValue: mailerService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("validateUser", () => {
    it("should return user without password when credentials are valid", async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser("joao@example.com", "senha123");

      expect(usersService.findByEmailForAuth).toHaveBeenCalledWith(
        "joao@example.com",
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        "senha123",
        "$2b$10$hashedpassword",
      );
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty("password");
      expect(result.id).toBe("user-uuid-1");
      expect(result.name).toBe("João Silva");
      expect(result.email).toBe("joao@example.com");
    });

    it("should normalize casing and trim whitespace in email before querying user", async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser("  JOAO@EXAMPLE.COM  ", "senha123");

      expect(usersService.findByEmailForAuth).toHaveBeenCalledWith(
        "joao@example.com",
      );
      expect(result).toBeDefined();
      expect(result.id).toBe("user-uuid-1");
    });

    it("should return null when email does not exist", async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(null);

      const result = await service.validateUser(
        "unknown@example.com",
        "senha123",
      );

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it("should return null when password is wrong", async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser(
        "joao@example.com",
        "wrongpassword",
      );

      expect(result).toBeNull();
    });

    it("should return null when bcrypt comparison throws", async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockRejectedValue(
        new Error("bcrypt error"),
      );

      await expect(
        service.validateUser("joao@example.com", "senha123"),
      ).rejects.toThrow("bcrypt error");
    });
  });

  describe("login", () => {
    it("should return access_token and user object", async () => {
      const user = {
        id: "user-uuid-1",
        name: "João Silva",
        email: "joao@example.com",
        role: "user",
      };
      jwtService.sign!.mockReturnValue("jwt-token-123");

      const result = await service.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({
        username: "João Silva",
        sub: "user-uuid-1",
        role: "user",
      });
      expect(result).toEqual({
        access_token: "jwt-token-123",
        user: {
          id: "user-uuid-1",
          name: "João Silva",
          email: "joao@example.com",
          role: "user",
          avatar: null,
          tenant: null,
        },
      });
    });
  });

  describe("requestPasswordReset", () => {
    it("should generate token, invalidate previous tokens, and send email when user exists", async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);
      prismaService.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prismaService.passwordResetToken.create.mockResolvedValue({ id: "token-1" });

      const result = await service.requestPasswordReset("joao@example.com");

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: "joao@example.com" },
      });
      expect(prismaService.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-uuid-1", used: false },
        data: { used: true },
      });
      expect(prismaService.passwordResetToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-uuid-1",
            used: false,
          }),
        }),
      );
      expect(mailerService.sendPasswordResetEmail).toHaveBeenCalledWith(
        "joao@example.com",
        "João Silva",
        expect.any(String),
      );
      expect(result).toHaveProperty("message");
    });

    it("should return generic message without sending email if user is not found", async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.requestPasswordReset("notfound@example.com");

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: "notfound@example.com" },
      });
      expect(prismaService.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(result).toHaveProperty("message");
    });
  });

  describe("resetPassword", () => {
    it("should throw BadRequestException if token is not found", async () => {
      prismaService.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: "invalid-token",
          password: "newPassword123!",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if token has already been used", async () => {
      prismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: "tok-1",
        token: "used-token",
        userId: "user-uuid-1",
        used: true,
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(
        service.resetPassword({
          token: "used-token",
          password: "newPassword123!",
        }),
      ).rejects.toThrow("Este token de recuperação já foi utilizado.");
    });

    it("should throw BadRequestException if token has expired", async () => {
      prismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: "tok-1",
        token: "expired-token",
        userId: "user-uuid-1",
        used: false,
        expiresAt: new Date(Date.now() - 10000), // in the past
      });

      await expect(
        service.resetPassword({
          token: "expired-token",
          password: "newPassword123!",
        }),
      ).rejects.toThrow("Este token de recuperação expirou.");
    });

    it("should update user password with bcrypt hash and mark token as used when token is valid", async () => {
      prismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: "tok-valid",
        token: "valid-token-123",
        userId: "user-uuid-1",
        used: false,
        expiresAt: new Date(Date.now() + 3600000),
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$10$newhashedpassword");

      const result = await service.resetPassword({
        token: "valid-token-123",
        password: "MyNewStrongPassword2026!",
      });

      expect(bcrypt.hash).toHaveBeenCalledWith("MyNewStrongPassword2026!", 10);
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        data: { password: "$2b$10$newhashedpassword" },
      });
      expect(prismaService.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: "tok-valid" },
        data: { used: true },
      });
      expect(result).toHaveProperty("message");
    });
  });
});
