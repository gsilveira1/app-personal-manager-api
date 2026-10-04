import { Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountStatus } from "@prisma/client";
import { JwtStrategy, passwordFingerprint } from "./jwt.strategy";
import { SessionAccount, UsersService } from "./users/users.service";

const HASH = "$2b$10$hashedpassword";

describe("JwtStrategy.validate", () => {
  let users: { findSessionAccount: jest.Mock };
  let strategy: JwtStrategy;
  let warn: jest.SpyInstance;

  const account = (
    overrides: Partial<SessionAccount> = {},
  ): SessionAccount => ({
    id: "u1",
    name: "Tina",
    role: "trainer",
    status: AccountStatus.ACTIVE,
    password: HASH,
    ...overrides,
  });
  const claims = (overrides: Record<string, unknown> = {}) => ({
    sub: "u1",
    username: "Tina",
    role: "trainer",
    pwd: passwordFingerprint(HASH),
    ...overrides,
  });

  beforeEach(() => {
    users = { findSessionAccount: jest.fn().mockResolvedValue(account()) };
    const config = {
      get: (key: string) => (key === "JWT_SECRET" ? "spec-secret" : undefined),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(config, users as unknown as UsersService);
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("returns the principal of an active account, read by primary key", async () => {
    await expect(strategy.validate(claims())).resolves.toEqual({
      userId: "u1",
      username: "Tina",
      role: "trainer",
    });
    expect(users.findSessionAccount).toHaveBeenCalledTimes(1);
    expect(users.findSessionAccount).toHaveBeenCalledWith("u1");
  });

  it("takes the role and the name from the database, not from the token", async () => {
    users.findSessionAccount.mockResolvedValue(account({ name: "Tina B." }));

    const principal = await strategy.validate(
      claims({ role: "admin", username: "Forged" }),
    );

    expect(principal).toEqual({
      userId: "u1",
      username: "Tina B.",
      role: "trainer",
    });
  });

  it("follows a promotion made after the token was issued", async () => {
    users.findSessionAccount.mockResolvedValue(account({ role: "admin" }));

    await expect(strategy.validate(claims())).resolves.toMatchObject({
      role: "admin",
    });
  });

  it("rejects a token whose account was deleted", async () => {
    users.findSessionAccount.mockResolvedValue(null);

    await expect(strategy.validate(claims())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(warn.mock.calls[0][0]).toContain("u1");
  });

  it("rejects a token whose account is BLOCKED", async () => {
    users.findSessionAccount.mockResolvedValue(
      account({ status: AccountStatus.BLOCKED }),
    );

    await expect(strategy.validate(claims())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(warn.mock.calls[0][0]).toContain("BLOCKED");
  });

  it("keeps an OVERDUE trainer signed in (contract A17: OVERDUE locks the student portal only)", async () => {
    users.findSessionAccount.mockResolvedValue(
      account({ status: AccountStatus.OVERDUE }),
    );

    await expect(strategy.validate(claims())).resolves.toMatchObject({
      userId: "u1",
    });
  });

  it("rejects a token issued before the password changed", async () => {
    users.findSessionAccount.mockResolvedValue(
      account({ password: "$2b$10$anotherhash" }),
    );

    await expect(strategy.validate(claims())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token without the password fingerprint", async () => {
    await expect(strategy.validate(claims({ pwd: undefined }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it.each([
    ["a student-portal payload", { action: "WORKOUT", clientId: "c1" }],
    ["any payload carrying `action`", { action: "" }],
    ["a role outside admin/trainer", { role: "student" }],
    ["a missing role", { role: undefined }],
    ["a subject that is not a string", { sub: 42 }],
  ])("rejects %s without touching the database", async (_label, override) => {
    await expect(strategy.validate(claims(override))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(users.findSessionAccount).not.toHaveBeenCalled();
  });

  it("rejects an account whose stored role is not admin or trainer", async () => {
    users.findSessionAccount.mockResolvedValue(account({ role: "student" }));

    await expect(strategy.validate(claims())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("propagates a database failure instead of answering 401", async () => {
    users.findSessionAccount.mockRejectedValue(new Error("connection lost"));

    await expect(strategy.validate(claims())).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("passwordFingerprint", () => {
  it("is stable for a hash, differs between hashes and never contains the hash", () => {
    expect(passwordFingerprint(HASH)).toBe(passwordFingerprint(HASH));
    expect(passwordFingerprint(HASH)).not.toBe(passwordFingerprint(`${HASH}x`));
    expect(passwordFingerprint(HASH)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});
