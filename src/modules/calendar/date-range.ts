import { BadRequestException } from "@nestjs/common";

const MS_PER_DAY = 24 * 3_600_000;

/**
 * Longest window an authenticated calendar query may ask for. Every series and
 * recurring block is expanded over the window, so it has to be bounded.
 */
export const MAX_RANGE_DAYS = 366;

/** Years a calendar date may fall in; anything else is a typo or an attack. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Parses one query-string date.
 *
 * @throws {BadRequestException} When the value is not a date or its year is outside
 * {@link MIN_YEAR}..{@link MAX_YEAR}
 */
export function parseDateParam(name: string, value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${name} must be an ISO 8601 date`);
  }
  const year = parsed.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new BadRequestException(
      `${name} year must be between ${MIN_YEAR} and ${MAX_YEAR}`,
    );
  }
  return parsed;
}

function assertWithin(range: DateRange, maxDays: number): DateRange {
  if (range.end.getTime() - range.start.getTime() > maxDays * MS_PER_DAY) {
    throw new BadRequestException(`range must not exceed ${maxDays} days`);
  }
  return range;
}

function assertOrdered(range: DateRange): DateRange {
  if (range.end < range.start) {
    throw new BadRequestException("end must not be before start");
  }
  return range;
}

/**
 * Range of a calendar query where both bounds are mandatory.
 *
 * @throws {BadRequestException} When a bound is missing, invalid, `end` precedes `start`,
 * or the range is longer than {@link MAX_RANGE_DAYS} days
 */
export function parseRequiredRange(start?: string, end?: string): DateRange {
  if (!start || !end) {
    throw new BadRequestException("start and end are required");
  }
  return assertWithin(
    assertOrdered({
      start: parseDateParam("start", start),
      end: parseDateParam("end", end),
    }),
    MAX_RANGE_DAYS,
  );
}

/**
 * Range of `GET /sessions`: both bounds or none.
 *
 * @returns undefined when no bound was sent (the caller lists one-off sessions only)
 * @throws {BadRequestException} When only one bound is sent or the range is invalid
 */
export function parseOptionalRange(
  start?: string,
  end?: string,
): DateRange | undefined {
  if (!start && !end) return undefined;
  return parseRequiredRange(start, end);
}

/**
 * Range of the public availability search: `start` defaults to today and `end` to
 * `start` + 30 days; longer than `maxDays` is refused (unauthenticated endpoint).
 *
 * @throws {BadRequestException} When a bound is invalid or the range exceeds `maxDays`
 */
export function parsePublicRange(
  start: string | undefined,
  end: string | undefined,
  maxDays: number,
  now: Date = new Date(),
): DateRange {
  const startDate = parseDateParam(
    "start",
    start || now.toISOString().split("T")[0],
  );
  const endDate = end
    ? parseDateParam("end", end)
    : new Date(startDate.getTime() + 30 * MS_PER_DAY);
  return assertWithin(
    assertOrdered({ start: startDate, end: endDate }),
    maxDays,
  );
}
