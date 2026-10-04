import { randomBytes } from "crypto";

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;
/** Lower-case words separated by single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Collisions are retried this many times with a random suffix. */
export const SLUG_COLLISION_RETRIES = 5;

const SUFFIX_LENGTH = 5; // "-xxxx"
const FALLBACK_BASE = "trainer";

/**
 * Turns a display name into a URL segment: lower-case, accents stripped,
 * non-alphanumerics collapsed to "-", at most 40 characters.
 *
 * @returns The slug; may be empty when the name has no latin letters or digits
 *
 * @example
 * slugify("João da Silva Júnior") // "joao-da-silva-junior"
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Appends "-xxxx" (4 random hex characters), keeping the result within 40 characters.
 *
 * @example
 * withRandomSuffix("gabriel-personal") // "gabriel-personal-9f3a"
 */
export function withRandomSuffix(base: string): string {
  const head = base
    .slice(0, SLUG_MAX_LENGTH - SUFFIX_LENGTH)
    .replace(/-+$/g, "");
  return `${head || FALLBACK_BASE}-${randomBytes(2).toString("hex")}`;
}

/**
 * Slug to try at sign-up.
 *
 * @param name - The trainer's display name
 * @param attempt - 0 for the first try; anything above adds a random suffix
 * @returns A slug matching {@link SLUG_PATTERN}, 3 to 40 characters
 *
 * @example
 * slugCandidate("Gabriel Personal", 0) // "gabriel-personal"
 * slugCandidate("Gabriel Personal", 1) // "gabriel-personal-41c7"
 */
export function slugCandidate(name: string, attempt: number): string {
  const base = slugify(name);
  if (attempt === 0 && base.length >= SLUG_MIN_LENGTH) return base;
  return withRandomSuffix(base);
}
