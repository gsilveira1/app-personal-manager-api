import { ConfigService } from "@nestjs/config";
import { resolveJwtSecret } from "./jwt-config";
import {
  PORTAL_TOKEN_AUDIENCE,
  SESSION_TOKEN_AUDIENCE,
} from "./token-audience";

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe("resolveJwtSecret", () => {
  it("returns JWT_SECRET when it is set", () => {
    expect(resolveJwtSecret(configWith({ JWT_SECRET: "s3cret" }))).toBe(
      "s3cret",
    );
  });

  it("falls back to the development secret outside production", () => {
    expect(resolveJwtSecret(configWith({ NODE_ENV: "test" }))).toBe(
      "segredo_padrao_dev",
    );
  });

  it("refuses to start in production without JWT_SECRET", () => {
    expect(() =>
      resolveJwtSecret(configWith({ NODE_ENV: "production" })),
    ).toThrow("JWT_SECRET must be set in production");
  });

  describe("in production", () => {
    const production = (secret: string) =>
      configWith({ NODE_ENV: "production", JWT_SECRET: secret });

    it.each([
      "seu_segredo_aqui",
      "segredo_padrao_dev",
      "seu_segredo_super_secreto_aqui",
      "e2e-secret-not-for-production",
      // Padding a known default does not make it a secret.
      "  seu_segredo_aqui  ",
    ])("refuses the known placeholder %p", (secret) => {
      expect(() => resolveJwtSecret(production(secret))).toThrow(
        "JWT_SECRET is a known placeholder value",
      );
    });

    it("refuses a secret shorter than 32 characters, without echoing it", () => {
      const short = "a".repeat(31);

      expect(() => resolveJwtSecret(production(short))).toThrow(
        "JWT_SECRET must have at least 32 characters in production (got 31)",
      );
      expect(() => resolveJwtSecret(production(short))).not.toThrow(
        new RegExp(short),
      );
    });

    it("accepts a random secret of 32 characters or more", () => {
      const secret = "k9Jw2nQ7xB4mT1vR8zL5cH3fD6gS0pYa";

      expect(resolveJwtSecret(production(secret))).toBe(secret);
    });
  });

  it("keeps accepting short or placeholder secrets outside production", () => {
    expect(
      resolveJwtSecret(
        configWith({ NODE_ENV: "development", JWT_SECRET: "seu_segredo_aqui" }),
      ),
    ).toBe("seu_segredo_aqui");
  });
});

describe("token audiences", () => {
  it("are distinct for trainer sessions and the student portal", () => {
    expect(SESSION_TOKEN_AUDIENCE).toBe("vivi:session");
    expect(PORTAL_TOKEN_AUDIENCE).toBe("vivi:portal");
  });
});
