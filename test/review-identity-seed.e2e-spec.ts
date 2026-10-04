/**
 * Security-review regression H2: the demo seed and the reset script must not run
 * against production. Nothing here opens a database connection.
 */
import { resetDatabase } from "../prisma/reset";
import { main as runSeed } from "../prisma/seed";
import {
  assertResetAllowed,
  assertSeedAllowed,
  resolveSeedPassword,
} from "../prisma/seed-guard";

const DATABASE_URL = "postgresql://nobody@127.0.0.1:1/never_connected_test";

describe("prisma/seed.ts in production (H2)", () => {
  it("rejects before any Prisma call when NODE_ENV=production", async () => {
    const connect = jest.fn();

    await expect(
      runSeed({ NODE_ENV: "production", DATABASE_URL }, connect),
    ).rejects.toThrow(/refusing to seed.*NODE_ENV=production/i);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects before any Prisma call when production is allowed but no admin password is given", async () => {
    const connect = jest.fn();

    await expect(
      runSeed(
        {
          NODE_ENV: "production",
          SEED_ALLOW_PRODUCTION: "true",
          DATABASE_URL,
        },
        connect,
      ),
    ).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects without DATABASE_URL, before connecting", async () => {
    const connect = jest.fn();

    await expect(runSeed({ NODE_ENV: "development" }, connect)).rejects.toThrow(
      "DATABASE_URL is required to seed.",
    );
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("prisma/reset.ts in production (H2)", () => {
  it.each([{}, { SEED_ALLOW_PRODUCTION: "true" }])(
    "refuses outright, with no override (%p)",
    async (extra) => {
      const connect = jest.fn();

      await expect(
        resetDatabase(
          { NODE_ENV: "production", DATABASE_URL, ...extra },
          connect,
        ),
      ).rejects.toThrow(/refusing to reset.*NODE_ENV=production/i);
      expect(connect).not.toHaveBeenCalled();
    },
  );
});

describe("seed guard", () => {
  it.each(["development", "test", undefined])(
    "allows NODE_ENV=%p",
    (NODE_ENV) => {
      expect(() => assertSeedAllowed({ NODE_ENV })).not.toThrow();
      expect(() => assertResetAllowed({ NODE_ENV })).not.toThrow();
    },
  );

  it.each([undefined, "", "1", "yes", "TRUE", "false"])(
    "treats SEED_ALLOW_PRODUCTION=%p as not allowed (only the literal true)",
    (SEED_ALLOW_PRODUCTION) => {
      expect(() =>
        assertSeedAllowed({ NODE_ENV: "production", SEED_ALLOW_PRODUCTION }),
      ).toThrow(/refusing to seed/i);
    },
  );

  it("allows production with SEED_ALLOW_PRODUCTION=true", () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "production",
        SEED_ALLOW_PRODUCTION: "true",
      }),
    ).not.toThrow();
  });

  describe("resolveSeedPassword", () => {
    const production = {
      NODE_ENV: "production",
      SEED_ALLOW_PRODUCTION: "true",
    };

    it("uses the demo password outside production", () => {
      expect(resolveSeedPassword({ NODE_ENV: "development" })).toBe("admin123");
    });

    it("prefers SEED_ADMIN_PASSWORD when it is set, in any environment", () => {
      expect(
        resolveSeedPassword({
          NODE_ENV: "development",
          SEED_ADMIN_PASSWORD: "uma-senha-bem-longa",
        }),
      ).toBe("uma-senha-bem-longa");
    });

    it("has no default in production", () => {
      expect(() => resolveSeedPassword(production)).toThrow(
        /SEED_ADMIN_PASSWORD/,
      );
    });

    it.each(["admin123", "curta"])(
      "refuses the demo or a short password in production, without echoing it (%p)",
      (SEED_ADMIN_PASSWORD) => {
        const attempt = () =>
          resolveSeedPassword({ ...production, SEED_ADMIN_PASSWORD });

        expect(attempt).toThrow(/SEED_ADMIN_PASSWORD/);
        expect(attempt).not.toThrow(new RegExp(SEED_ADMIN_PASSWORD));
      },
    );

    it("accepts a long password in production", () => {
      expect(
        resolveSeedPassword({
          ...production,
          SEED_ADMIN_PASSWORD: "c0rrect-horse-battery",
        }),
      ).toBe("c0rrect-horse-battery");
    });
  });
});
