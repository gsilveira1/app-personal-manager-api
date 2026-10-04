import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import { GcsService } from "../../gcs/gcs.service";
import { PrismaService } from "../../prisma/prisma.service";
import { buildUser, prismaError } from "../testing";
import { UsersService } from "./users.service";

jest.mock("bcrypt");

describe("UsersService", () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let gcs: { generateSignedUploadUrl: jest.Mock };

  const mockUser = buildUser();
  const signup = {
    name: "João Silva",
    email: "joao@example.com",
    password: "senha123",
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    gcs = { generateSignedUploadUrl: jest.fn() };
    (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$10$newhashedpassword");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: GcsService, useValue: gcs },
      ],
    }).compile();
    module.useLogger(false);
    service = module.get(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("create", () => {
    it("hashes the password and creates one trainer account with a slug", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.create(signup);

      expect(bcrypt.hash).toHaveBeenCalledWith("senha123", 10);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          name: "João Silva",
          email: "joao@example.com",
          password: "$2b$10$newhashedpassword",
          role: "trainer",
          slug: "joao-silva",
        },
      });
      expect(result).toBe(mockUser);
    });

    it("normalizes the e-mail (lower case, trimmed) for the uniqueness check and the insert", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUser);

      await service.create({ ...signup, email: "  JoAo@Example.COM  " });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "joao@example.com" },
        select: { id: true },
      });
      expect(prisma.user.create.mock.calls[0][0].data.email).toBe(
        "joao@example.com",
      );
    });

    it("throws ConflictException when the e-mail already exists", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "other" });

      await expect(service.create(signup)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("always creates a trainer, even when the payload smuggles a role", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUser);

      await service.create({ ...signup, role: "admin" } as any);

      expect(prisma.user.create.mock.calls[0][0].data.role).toBe("trainer");
    });

    it("retries with a random suffix when the slug is taken (P2002 on slug)", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create
        .mockRejectedValueOnce(prismaError("P2002", { target: ["slug"] }))
        .mockResolvedValueOnce(mockUser);

      await service.create(signup);

      expect(prisma.user.create).toHaveBeenCalledTimes(2);
      expect(prisma.user.create.mock.calls[0][0].data.slug).toBe("joao-silva");
      expect(prisma.user.create.mock.calls[1][0].data.slug).toMatch(
        /^joao-silva-[0-9a-f]{4}$/,
      );
    });

    it("gives up after 5 retries (6 inserts) with a 500, never an endless loop", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        prismaError("P2002", { target: ["slug"] }),
      );

      await expect(service.create(signup)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(prisma.user.create).toHaveBeenCalledTimes(6);
    });

    it("answers 409 when a concurrent sign-up took the e-mail (P2002 on email)", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        prismaError("P2002", { target: ["email"] }),
      );

      await expect(service.create(signup)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it("looks the e-mail up when Prisma does not name the violated column", async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // pre-check
        .mockResolvedValueOnce({ id: "other" }); // after the anonymous P2002
      prisma.user.create.mockRejectedValue(prismaError("P2002"));

      await expect(service.create(signup)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it("treats an anonymous P2002 as a slug collision when the e-mail is free", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create
        .mockRejectedValueOnce(prismaError("P2002"))
        .mockResolvedValueOnce(mockUser);

      await expect(service.create(signup)).resolves.toBe(mockUser);
      expect(prisma.user.create).toHaveBeenCalledTimes(2);
    });

    it("rethrows any other database error untouched", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(new Error("connection lost"));

      await expect(service.create(signup)).rejects.toThrow("connection lost");
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("findOne", () => {
    it("returns the user view without the password", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findOne("user-uuid-1");

      expect(result).not.toHaveProperty("password");
      expect(result.email).toBe("joao@example.com");
      expect(result.settings.language).toBe("pt-BR");
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("findByEmailForAuth", () => {
    it("returns the user WITH the password for the comparison", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByEmailForAuth("joao@example.com");

      expect(result?.password).toBe("$2b$10$hashedpassword");
    });

    it("normalizes the e-mail before querying", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await service.findByEmailForAuth("  JoAo@Example.COM  ");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "joao@example.com" },
      });
    });

    it("returns null for a non-existent or empty e-mail", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.findByEmailForAuth("x@test.com"),
      ).resolves.toBeNull();
      await expect(service.findByEmailForAuth("")).resolves.toBeNull();
    });
  });

  describe("findSessionAccount", () => {
    it("reads only what the session check needs, by primary key", async () => {
      const row = {
        id: "user-uuid-1",
        name: "João Silva",
        role: "trainer",
        status: "ACTIVE",
        password: "$2b$10$hashedpassword",
      };
      prisma.user.findUnique.mockResolvedValue(row);

      await expect(service.findSessionAccount("user-uuid-1")).resolves.toBe(
        row,
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        select: {
          id: true,
          name: true,
          role: true,
          status: true,
          password: true,
        },
      });
    });

    it("returns null for an account that no longer exists", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findSessionAccount("ghost")).resolves.toBeNull();
    });
  });

  describe("updateProfile", () => {
    it("rehashes the password when provided", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.updateProfile("user-uuid-1", {
        password: "novaSenha",
      });

      expect(bcrypt.hash).toHaveBeenCalledWith("novaSenha", 10);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        data: { password: "$2b$10$newhashedpassword" },
      });
      expect(result).not.toHaveProperty("password");
    });

    it("updates profile fields including avatar, phone, bio and slug", async () => {
      const dto = {
        name: "João Novo",
        avatar: "https://cdn/avatar.png",
        phone: "53999990000",
        bio: "Personal trainer",
        slug: "joao-novo",
      };
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(buildUser(dto));

      const result = await service.updateProfile("user-uuid-1", dto);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        data: dto,
      });
      expect(result).toMatchObject(dto);
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it("stores the e-mail lower-cased and trimmed", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      await service.updateProfile("user-uuid-1", {
        email: " NEW@Example.com ",
      });

      expect(prisma.user.update.mock.calls[0][0].data.email).toBe(
        "new@example.com",
      );
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile("non-existent", { name: "x" }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("answers 409 when the slug is taken", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockRejectedValue(
        prismaError("P2002", { target: ["slug"] }),
      );

      await expect(
        service.updateProfile("user-uuid-1", { slug: "taken" }),
      ).rejects.toThrow(/slug/);
      await expect(
        service.updateProfile("user-uuid-1", { slug: "taken" }),
      ).rejects.toThrow(ConflictException);
    });

    it("answers 409 when the e-mail is taken", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockRejectedValue(
        prismaError("P2002", { target: ["email"] }),
      );

      await expect(
        service.updateProfile("user-uuid-1", { email: "taken@example.com" }),
      ).rejects.toThrow(new ConflictException("Este e-mail já está em uso."));
    });

    it("answers 409 even when Prisma does not name the column", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockRejectedValue(prismaError("P2002"));

      await expect(
        service.updateProfile("user-uuid-1", { slug: "taken" }),
      ).rejects.toThrow(ConflictException);
    });

    it("rethrows any other database error untouched", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockRejectedValue(new Error("connection lost"));

      await expect(
        service.updateProfile("user-uuid-1", { name: "x" }),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("updateBranding", () => {
    it("updates the branding fields on the user and returns the view", async () => {
      prisma.user.update.mockResolvedValue(
        buildUser({ logoUrl: "https://cdn/logo.png", primaryColor: "#FF0000" }),
      );

      const result = await service.updateBranding("user-uuid-1", {
        logoUrl: "https://cdn/logo.png",
        primaryColor: "#FF0000",
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        data: { logoUrl: "https://cdn/logo.png", primaryColor: "#FF0000" },
      });
      expect(result.logoUrl).toBe("https://cdn/logo.png");
      expect(result.primaryColor).toBe("#FF0000");
      expect(result).not.toHaveProperty("password");
    });

    it("leaves an omitted field untouched", async () => {
      prisma.user.update.mockResolvedValue(mockUser);

      await service.updateBranding("user-uuid-1", { primaryColor: "#000000" });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        primaryColor: "#000000",
      });
    });

    it("throws NotFoundException when the user does not exist (P2025)", async () => {
      prisma.user.update.mockRejectedValue(prismaError("P2025"));
      await expect(
        service.updateBranding("ghost", { primaryColor: "#000000" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("completeSetup", () => {
    it("sets setupCompleted and returns { success, user }", async () => {
      prisma.user.update.mockResolvedValue(buildUser({ setupCompleted: true }));

      const result = await service.completeSetup("user-uuid-1");

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-uuid-1" },
        data: { setupCompleted: true },
      });
      expect(result.success).toBe(true);
      expect(result.user.setupCompleted).toBe(true);
      expect(result.user).not.toHaveProperty("password");
    });

    it("throws NotFoundException when the user does not exist (P2025)", async () => {
      prisma.user.update.mockRejectedValue(prismaError("P2025"));
      await expect(service.completeSetup("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("generateAvatarUploadUrl", () => {
    it("generates a signed upload URL for the user's avatar", async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      gcs.generateSignedUploadUrl.mockResolvedValue({
        uploadUrl: "https://upload.url",
        publicUrl: "https://public.url",
      });

      const result = await service.generateAvatarUploadUrl(
        "user-uuid-1",
        "image/png",
      );

      expect(gcs.generateSignedUploadUrl).toHaveBeenCalledWith(
        "avatars/users/user-uuid-1.png",
        "image/png",
      );
      expect(result).toEqual({
        uploadUrl: "https://upload.url",
        publicUrl: "https://public.url",
      });
    });

    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.generateAvatarUploadUrl("ghost", "image/png"),
      ).rejects.toThrow(NotFoundException);
      expect(gcs.generateSignedUploadUrl).not.toHaveBeenCalled();
    });
  });
});
