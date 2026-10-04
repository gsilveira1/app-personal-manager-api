import { BadRequestException } from "@nestjs/common";
import {
  MAX_RANGE_DAYS,
  parseOptionalRange,
  parsePublicRange,
  parseRequiredRange,
} from "./date-range";

describe("parseRequiredRange", () => {
  it("parses both bounds", () => {
    expect(parseRequiredRange("2025-01-01", "2025-01-31")).toEqual({
      start: new Date("2025-01-01"),
      end: new Date("2025-01-31"),
    });
  });

  it.each([
    ["start is missing", undefined, "2025-01-31"],
    ["end is missing", "2025-01-01", undefined],
    ["start is not a date", "nope", "2025-01-31"],
    ["end is not a date", "2025-01-01", "nope"],
    ["end precedes start", "2025-02-01", "2025-01-01"],
  ])("answers 400 when %s", (_label, start, end) => {
    expect(() => parseRequiredRange(start, end)).toThrow(BadRequestException);
  });
});

describe("parseOptionalRange", () => {
  it("returns undefined when no bound is sent", () => {
    expect(parseOptionalRange(undefined, undefined)).toBeUndefined();
  });

  it("answers 400 when only one bound is sent", () => {
    expect(() => parseOptionalRange("2025-01-01", undefined)).toThrow(
      BadRequestException,
    );
  });

  it("parses a full range", () => {
    expect(parseOptionalRange("2025-01-01", "2025-01-02")).toEqual({
      start: new Date("2025-01-01"),
      end: new Date("2025-01-02"),
    });
  });
});

describe("parsePublicRange", () => {
  const now = new Date("2025-03-10T15:30:00Z");

  it("defaults start to today and end to start + 30 days", () => {
    expect(parsePublicRange(undefined, undefined, 92, now)).toEqual({
      start: new Date("2025-03-10"),
      end: new Date("2025-04-09"),
    });
  });

  it("accepts a range of exactly the maximum length", () => {
    expect(() =>
      parsePublicRange("2025-01-01", "2025-04-03", 92, now),
    ).not.toThrow();
  });

  it("answers 400 for a range longer than the maximum", () => {
    expect(() => parsePublicRange("2025-01-01", "2025-04-04", 92, now)).toThrow(
      BadRequestException,
    );
  });

  it("answers 400 for an invalid date", () => {
    expect(() => parsePublicRange("garbage", undefined, 92, now)).toThrow(
      BadRequestException,
    );
  });

  it("answers 400 when end precedes start", () => {
    expect(() => parsePublicRange("2025-03-10", "2025-03-01", 92, now)).toThrow(
      BadRequestException,
    );
  });
});

describe("range limits (regression H1: a 10-year range used to expand millions of occurrences)", () => {
  it("accepts a range of exactly 366 days", () => {
    expect(MAX_RANGE_DAYS).toBe(366);
    expect(() =>
      parseRequiredRange("2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z"),
    ).not.toThrow();
  });

  it("answers 400 for a range one millisecond longer than 366 days", () => {
    expect(() =>
      parseRequiredRange(
        "2024-01-01T00:00:00.000Z",
        "2025-01-01T00:00:00.001Z",
      ),
    ).toThrow(new BadRequestException("range must not exceed 366 days"));
  });

  it("answers 400 for a 10-year range, through the optional parser too", () => {
    expect(() => parseRequiredRange("2025-01-01", "2035-01-01")).toThrow(
      BadRequestException,
    );
    expect(() => parseOptionalRange("2025-01-01", "2035-01-01")).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ["start", "0100-01-01", "0100-01-31"],
    ["end", "9999-12-01", "9999-12-31"],
    ["start (public)", "0100-01-01", undefined],
  ])("answers 400 for an absurd year in %s", (label, start, end) => {
    const parse = () =>
      label.includes("public")
        ? parsePublicRange(start, end, 92)
        : parseRequiredRange(start, end);

    expect(parse).toThrow(/year/);
    expect(parse).toThrow(BadRequestException);
  });
});
