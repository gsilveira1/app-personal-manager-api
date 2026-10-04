import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { RRuleSet, rrulestr } from "rrule";

import { MAX_YEAR, MIN_YEAR } from "./date-range";

/** Frequencies a calendar rule may use. Sub-daily rules would expand without bound. */
const ALLOWED_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

/**
 * The only RRULE parts a calendar rule may carry. Everything else (BYHOUR, BYMINUTE,
 * BYSECOND, BYSETPOS, BYYEARDAY, BYWEEKNO, ...) is refused: with them a daily rule
 * yields up to 86,400 occurrences per day. With these parts a rule yields at most one
 * occurrence per day.
 */
export const ALLOWED_RRULE_KEYS = [
  "FREQ",
  "INTERVAL",
  "COUNT",
  "UNTIL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "WKST",
] as const;

/**
 * Occurrences one rule may yield in one query. A daily rule over the longest range an
 * endpoint accepts (366 days) yields 367, so a valid request never reaches it.
 */
export const MAX_OCCURRENCES_PER_EXPANSION = 1000;

const MAX_RRULE_LENGTH = 200;
const MAX_INTERVAL = 999;
const MAX_COUNT = 9999;
const MAX_MONTH_ORDINAL = 5;
const MAX_YEAR_ORDINAL = 53;
/** Longest length of each month (February in a leap year). */
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ALL_MONTHS = MONTH_LENGTHS.map((_length, index) => index + 1);

const RULE_SHAPE = /^FREQ=([A-Z]+)(;[A-Z]+=[^;\s]+)*$/;
const UNSIGNED_INT = /^\d{1,4}$/;
const SIGNED_INT = /^[+-]?\d{1,2}$/;
const WEEKDAY = /^(MO|TU|WE|TH|FR|SA|SU)$/;
const BYDAY_ITEM = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;
const UNTIL_SHAPE = /^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/;

type RuleParts = Map<string, string>;

/** Thrown when one rule yields more than {@link MAX_OCCURRENCES_PER_EXPANSION} occurrences in one query. */
export class RRuleExpansionLimitError extends UnprocessableEntityException {
  constructor() {
    super(
      `A recurrence rule yields more than ${MAX_OCCURRENCES_PER_EXPANSION} occurrences in the requested range`,
    );
  }
}

/** Thrown when a stored rule is not one this module accepts; callers log it and leave the rule out. */
export class UnsupportedRRuleError extends Error {}

const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

function intProblem(key: string, value: string, max: number): string | null {
  return UNSIGNED_INT.test(value) && inRange(Number(value), 1, max)
    ? null
    : `rrule ${key} must be an integer between 1 and ${max}`;
}

function untilProblem(value: string): string | null {
  const match = UNTIL_SHAPE.exec(value);
  if (!match) {
    return "rrule UNTIL must be YYYYMMDD or YYYYMMDDTHHMMSSZ";
  }
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const [hour, minute, second] = [match[5], match[6], match[7]].map((part) =>
    Number(part ?? 0),
  );
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const isRealInstant =
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  if (!isRealInstant) return "rrule UNTIL is not a valid date";
  return inRange(year, MIN_YEAR, MAX_YEAR)
    ? null
    : `rrule UNTIL year must be between ${MIN_YEAR} and ${MAX_YEAR}`;
}

function listProblem(
  key: string,
  value: string,
  isValid: (item: string) => boolean,
  expected: string,
): string | null {
  return value.split(",").every(isValid)
    ? null
    : `rrule ${key} must be a comma-separated list of ${expected}`;
}

const isMonthDay = (item: string) =>
  SIGNED_INT.test(item) && inRange(Math.abs(Number(item)), 1, 31);

const isMonth = (item: string) =>
  UNSIGNED_INT.test(item) && inRange(Number(item), 1, 12);

function isByDayItem(item: string): boolean {
  const match = BYDAY_ITEM.exec(item);
  if (!match) return false;
  return (
    match[1] === undefined ||
    inRange(Math.abs(Number(match[1])), 1, MAX_YEAR_ORDINAL)
  );
}

const PART_PROBLEMS: Record<string, (value: string) => string | null> = {
  FREQ: (value) =>
    (ALLOWED_FREQUENCIES as readonly string[]).includes(value)
      ? null
      : `rrule frequency must be one of ${ALLOWED_FREQUENCIES.join(", ")}`,
  INTERVAL: (value) => intProblem("INTERVAL", value, MAX_INTERVAL),
  COUNT: (value) => intProblem("COUNT", value, MAX_COUNT),
  UNTIL: untilProblem,
  BYDAY: (value) =>
    listProblem("BYDAY", value, isByDayItem, "weekdays such as MO or -1FR"),
  BYMONTHDAY: (value) =>
    listProblem("BYMONTHDAY", value, isMonthDay, "days 1..31 or -31..-1"),
  BYMONTH: (value) => listProblem("BYMONTH", value, isMonth, "months 1..12"),
  WKST: (value) =>
    WEEKDAY.test(value) ? null : "rrule WKST must be a weekday such as MO",
};

function splitParts(rrule: string): RuleParts | string {
  const parts: RuleParts = new Map();
  for (const part of rrule.split(";")) {
    const separator = part.indexOf("=");
    const key = part.slice(0, separator);
    if (!(ALLOWED_RRULE_KEYS as readonly string[]).includes(key)) {
      return `rrule part ${key} is not supported; allowed parts: ${ALLOWED_RRULE_KEYS.join(", ")}`;
    }
    if (parts.has(key)) return `rrule part ${key} is repeated`;
    parts.set(key, part.slice(separator + 1));
  }
  return parts;
}

const ordinalsOf = (byDay: string) =>
  byDay
    .split(",")
    .map((item) => BYDAY_ITEM.exec(item)?.[1])
    .filter((ordinal): ordinal is string => ordinal !== undefined)
    .map((ordinal) => Math.abs(Number(ordinal)));

function byDayProblem(parts: RuleParts): string | null {
  const byDay = parts.get("BYDAY");
  if (!byDay) return null;
  const freq = parts.get("FREQ");
  const ordinals = ordinalsOf(byDay);

  if (ordinals.length === 0) {
    return freq === "DAILY" && Number(parts.get("INTERVAL") ?? 1) > 1
      ? "rrule BYDAY cannot be combined with FREQ=DAILY and INTERVAL above 1"
      : null;
  }
  if (freq !== "MONTHLY" && freq !== "YEARLY") {
    return "rrule BYDAY with an ordinal (e.g. 1MO) requires FREQ=MONTHLY or YEARLY";
  }
  const withinMonth = freq === "MONTHLY" || parts.has("BYMONTH");
  return withinMonth && ordinals.some((n) => n > MAX_MONTH_ORDINAL)
    ? `rrule BYDAY ordinal must be between 1 and ${MAX_MONTH_ORDINAL} within a month`
    : null;
}

function monthDayProblem(parts: RuleParts): string | null {
  const byMonthDay = parts.get("BYMONTHDAY");
  if (!byMonthDay) return null;
  const freq = parts.get("FREQ");
  if (freq !== "MONTHLY" && freq !== "YEARLY") {
    return "rrule BYMONTHDAY requires FREQ=MONTHLY or YEARLY";
  }
  const months = parts.get("BYMONTH")?.split(",").map(Number) ?? ALL_MONTHS;
  const days = byMonthDay.split(",").map((day) => Math.abs(Number(day)));
  const exists = months.some((month) =>
    days.some((day) => day <= MONTH_LENGTHS[month - 1]),
  );
  return exists ? null : "rrule BYMONTHDAY never falls in a BYMONTH month";
}

/**
 * Why a rule is not one the calendar accepts: unknown part, value out of bounds, or a
 * combination that rrule.js would walk for years without finding an occurrence.
 *
 * @returns null when the rule is acceptable
 *
 * @example
 * findRRuleProblem("FREQ=DAILY;BYSECOND=0,1"); // "rrule part BYSECOND is not supported; ..."
 */
export function findRRuleProblem(rrule: string): string | null {
  if (rrule.length > MAX_RRULE_LENGTH) {
    return `rrule must not exceed ${MAX_RRULE_LENGTH} characters`;
  }
  if (!RULE_SHAPE.test(rrule)) {
    return "rrule must start with FREQ= and contain only KEY=VALUE parts separated by ';'";
  }
  const parts = splitParts(rrule);
  if (typeof parts === "string") return parts;

  for (const [key, value] of parts) {
    const problem = PART_PROBLEMS[key](value);
    if (problem) return problem;
  }
  return byDayProblem(parts) ?? monthDayProblem(parts);
}

function startProblem(dtstart: Date): string | null {
  return inRange(dtstart.getUTCFullYear(), MIN_YEAR, MAX_YEAR)
    ? null
    : `DTSTART year must be between ${MIN_YEAR} and ${MAX_YEAR}`;
}

function buildRuleSet(rrule: string, dtstart: Date): RRuleSet {
  const dtstartISO =
    dtstart.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  return rrulestr(`DTSTART:${dtstartISO}\nRRULE:${rrule}`, {
    forceset: true,
  }) as RRuleSet;
}

/**
 * Expand an RRULE string into occurrence dates within a given range.
 *
 * @param rrule - RFC 5545 RRULE string (e.g. "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12")
 * @param dtstart - The DTSTART of the rule
 * @param timezone - TZID for expansion (currently unused by rrule.js but kept for forward-compat)
 * @param rangeStart - Start of the query window (inclusive)
 * @param rangeEnd - End of the query window (inclusive)
 * @param exdates - Dates to exclude from the expansion (e.g. occurrences replaced by an exception)
 * @returns Array of occurrence dates within the range
 * @throws {UnsupportedRRuleError} When the rule or its DTSTART is not acceptable (never expanded)
 * @throws {RRuleExpansionLimitError} When the rule yields more than
 * {@link MAX_OCCURRENCES_PER_EXPANSION} occurrences in the range (never truncated)
 * @throws {Error} When rrule.js cannot parse the rule (callers decide how to degrade)
 */
export function expandRRuleForRange(
  rrule: string,
  dtstart: Date,
  timezone: string,
  rangeStart: Date,
  rangeEnd: Date,
  exdates: Date[] = [],
): Date[] {
  const problem = findRRuleProblem(rrule) ?? startProblem(dtstart);
  if (problem) throw new UnsupportedRRuleError(problem);

  const ruleSet = buildRuleSet(rrule, dtstart);
  for (const exdate of exdates) {
    ruleSet.exdate(new Date(exdate));
  }

  let exceeded = false;
  const occurrences = ruleSet.between(
    rangeStart,
    rangeEnd,
    true,
    (_date, found) => {
      exceeded = found >= MAX_OCCURRENCES_PER_EXPANSION;
      return !exceeded;
    },
  );
  if (exceeded) throw new RRuleExpansionLimitError();
  return occurrences;
}

/**
 * Write-time validation of a recurrence rule: only the parts in
 * {@link ALLOWED_RRULE_KEYS} with bounded values, a daily-or-slower frequency, a sane
 * DTSTART, and at least one occurrence from DTSTART on.
 *
 * @example
 * assertValidRRule("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12", new Date("2025-01-06T10:00:00Z"));
 *
 * @throws {BadRequestException} When the rule is malformed, not supported or never occurs
 */
export function assertValidRRule(rrule: string, dtstart: Date): void {
  const problem = findRRuleProblem(rrule) ?? startProblem(dtstart);
  if (problem) throw new BadRequestException(problem);

  let first: Date | null;
  try {
    first = buildRuleSet(rrule, dtstart).after(dtstart, true);
  } catch (error) {
    throw new BadRequestException(
      `rrule could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!first) {
    throw new BadRequestException(
      "rrule has no occurrence on or after the start date",
    );
  }
}
