import {
  slugCandidate,
  slugify,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  withRandomSuffix,
} from "./slug";

describe("slug", () => {
  describe("slugify", () => {
    it("lower-cases, strips accents and replaces non-alphanumerics with a dash", () => {
      expect(slugify("João da Silva Júnior")).toBe("joao-da-silva-junior");
      expect(slugify("  Ana & Cia. -- Studio!  ")).toBe("ana-cia-studio");
    });

    it("trims to 40 characters without leaving a trailing dash", () => {
      const slug = slugify("a".repeat(39) + " bcdef");
      expect(slug).toBe("a".repeat(39));
      expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    });

    it("returns an empty string when nothing usable is left", () => {
      expect(slugify("!!! ???")).toBe("");
      expect(slugify("日本語")).toBe("");
    });
  });

  describe("withRandomSuffix", () => {
    it("appends -xxxx (4 hex characters)", () => {
      expect(withRandomSuffix("gabriel")).toMatch(/^gabriel-[0-9a-f]{4}$/);
    });

    it("keeps the result within 40 characters", () => {
      const slug = withRandomSuffix("a".repeat(40));
      expect(slug).toHaveLength(SLUG_MAX_LENGTH);
      expect(slug).toMatch(SLUG_PATTERN);
    });

    it("produces a different suffix on each call", () => {
      const slugs = new Set(
        Array.from({ length: 20 }, () => withRandomSuffix("x")),
      );
      expect(slugs.size).toBeGreaterThan(1);
    });
  });

  describe("slugCandidate", () => {
    it("uses the plain slug on the first attempt", () => {
      expect(slugCandidate("Gabriel Personal", 0)).toBe("gabriel-personal");
    });

    it("adds a random suffix on a retry", () => {
      expect(slugCandidate("Gabriel Personal", 1)).toMatch(
        /^gabriel-personal-[0-9a-f]{4}$/,
      );
    });

    it("never returns a slug shorter than 3 characters", () => {
      expect(slugCandidate("Jo", 0)).toMatch(/^jo-[0-9a-f]{4}$/);
      expect(slugCandidate("!!!", 0)).toMatch(/^trainer-[0-9a-f]{4}$/);
    });

    it.each(["Gabriel", "Jo", "", "Élodie d'Ávila", "a".repeat(80)])(
      "always matches the profile slug rule (%s)",
      (name) => {
        for (const attempt of [0, 1]) {
          const slug = slugCandidate(name, attempt);
          expect(slug).toMatch(SLUG_PATTERN);
          expect(slug.length).toBeGreaterThanOrEqual(3);
          expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
        }
      },
    );
  });
});
