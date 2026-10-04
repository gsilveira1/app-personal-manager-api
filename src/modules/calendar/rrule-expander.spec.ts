import { BadRequestException } from "@nestjs/common";
import {
  assertValidRRule,
  expandRRuleForRange,
  MAX_OCCURRENCES_PER_EXPANSION,
  RRuleExpansionLimitError,
} from "./rrule-expander";

describe("expandRRuleForRange", () => {
  const timezone = "America/Sao_Paulo";

  it("should expand weekly RRULE into correct occurrences", () => {
    const dtstart = new Date("2025-01-06T10:00:00Z"); // Monday
    const rangeStart = new Date("2025-01-01T00:00:00Z");
    const rangeEnd = new Date("2025-01-31T23:59:59Z");

    const occurrences = expandRRuleForRange(
      "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
    );

    expect(occurrences).toHaveLength(4);
    expect(occurrences[0].getDate()).toBe(6);
    expect(occurrences[1].getDate()).toBe(13);
    expect(occurrences[2].getDate()).toBe(20);
    expect(occurrences[3].getDate()).toBe(27);
  });

  it("should respect exdates", () => {
    const dtstart = new Date("2025-01-06T10:00:00Z");
    const rangeStart = new Date("2025-01-01T00:00:00Z");
    const rangeEnd = new Date("2025-01-31T23:59:59Z");

    const occurrences = expandRRuleForRange(
      "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
      [new Date("2025-01-13T10:00:00Z")],
    );

    expect(occurrences).toHaveLength(3);
    const dates = occurrences.map((d) => d.getDate());
    expect(dates).not.toContain(13);
  });

  it("should return empty array for range with no occurrences", () => {
    const dtstart = new Date("2025-03-01T10:00:00Z");
    const rangeStart = new Date("2025-01-01T00:00:00Z");
    const rangeEnd = new Date("2025-01-31T23:59:59Z");

    const occurrences = expandRRuleForRange(
      "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
    );

    expect(occurrences).toHaveLength(0);
  });

  it("should handle daily frequency", () => {
    const dtstart = new Date("2025-01-06T08:00:00Z");
    const rangeStart = new Date("2025-01-06T00:00:00Z");
    const rangeEnd = new Date("2025-01-08T23:59:59Z");

    const occurrences = expandRRuleForRange(
      "FREQ=DAILY;COUNT=5",
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
    );

    expect(occurrences).toHaveLength(3); // Jan 6, 7, 8
  });

  it("should handle multiple BYDAY values", () => {
    const dtstart = new Date("2025-01-06T10:00:00Z"); // Monday
    const rangeStart = new Date("2025-01-06T00:00:00Z");
    const rangeEnd = new Date("2025-01-12T23:59:59Z"); // One week

    const occurrences = expandRRuleForRange(
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
    );

    // Mon Jan 6, Wed Jan 8, Fri Jan 10
    expect(occurrences).toHaveLength(3);
  });
});

describe("expandRRuleForRange - malformed rules", () => {
  it("should throw so that the caller can log and degrade", () => {
    expect(() =>
      expandRRuleForRange(
        "INVALID_RRULE_STRING",
        new Date("2025-01-06T10:00:00Z"),
        "America/Sao_Paulo",
        new Date("2025-01-01T00:00:00Z"),
        new Date("2025-01-31T23:59:59Z"),
      ),
    ).toThrow();
  });
});

/** A Monday before every UNTIL used below. */
const DTSTART = new Date("2024-01-01T10:00:00Z");

describe("assertValidRRule", () => {
  it.each([
    "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12",
    "FREQ=DAILY",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20250101T000000Z",
    "FREQ=MONTHLY;BYMONTHDAY=15",
  ])("accepts %s", (rule) => {
    expect(() => assertValidRRule(rule, DTSTART)).not.toThrow();
  });

  it.each([
    ["does not start with FREQ=", "INVALID_RRULE"],
    ["has an unknown frequency", "FREQ=BOGUS"],
    ["has an unknown property", "FREQ=WEEKLY;FOO=1"],
    ["has an invalid weekday", "FREQ=WEEKLY;BYDAY=XX"],
    ["smuggles a second line", "FREQ=DAILY\nEXDATE:20250106T100000Z"],
    ["is empty", ""],
  ])("rejects a rule that %s", (_label, rule) => {
    expect(() => assertValidRRule(rule, DTSTART)).toThrow(BadRequestException);
  });

  it.each(["FREQ=SECONDLY", "FREQ=MINUTELY", "FREQ=HOURLY"])(
    "rejects the sub-daily frequency %s (unbounded expansion)",
    (rule) => {
      expect(() => assertValidRRule(rule, DTSTART)).toThrow(
        BadRequestException,
      );
    },
  );
});

describe("assertValidRRule — key whitelist (regression H1: only FREQ used to be checked)", () => {
  it.each([
    "FREQ=DAILY;BYSECOND=0,1",
    "FREQ=DAILY;BYHOUR=0,1,2;BYMINUTE=0,1;BYSECOND=0,1",
    "FREQ=DAILY;BYMINUTE=0,30",
    "FREQ=DAILY;BYHOUR=9,15",
    "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1",
    "FREQ=YEARLY;BYYEARDAY=1,100",
    "FREQ=YEARLY;BYWEEKNO=20",
    "FREQ=DAILY;TZID=America/Sao_Paulo",
  ])("rejects %s with 400", (rule) => {
    expect(() => assertValidRRule(rule, DTSTART)).toThrow(BadRequestException);
  });

  it.each([
    "FREQ=YEARLY",
    "FREQ=DAILY;INTERVAL=1",
    "FREQ=DAILY;COUNT=5",
    "FREQ=WEEKLY;UNTIL=20261231T235959Z",
    "FREQ=WEEKLY;UNTIL=20261231",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    "FREQ=MONTHLY;BYDAY=1MO,-1FR",
    "FREQ=MONTHLY;BYMONTHDAY=1,15,-1",
    "FREQ=YEARLY;BYMONTH=1,6,12",
    "FREQ=WEEKLY;WKST=SU;BYDAY=TU",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20270101T000000Z;WKST=MO",
  ])("accepts the whitelisted rule %s", (rule) => {
    expect(() => assertValidRRule(rule, DTSTART)).not.toThrow();
  });

  it.each([
    ["INTERVAL below 1", "FREQ=DAILY;INTERVAL=0"],
    ["a negative INTERVAL", "FREQ=DAILY;INTERVAL=-1"],
    ["an INTERVAL that is not a number", "FREQ=DAILY;INTERVAL=two"],
    ["an oversized INTERVAL", "FREQ=DAILY;INTERVAL=100000"],
    ["COUNT below 1", "FREQ=DAILY;COUNT=0"],
    ["an oversized COUNT", "FREQ=DAILY;COUNT=99999999"],
    ["an UNTIL that is not a date", "FREQ=DAILY;UNTIL=tomorrow"],
    ["an UNTIL on an impossible day", "FREQ=DAILY;UNTIL=20261341"],
    ["an UNTIL in an absurd year", "FREQ=DAILY;UNTIL=99991231T000000Z"],
    ["BYMONTHDAY out of range", "FREQ=MONTHLY;BYMONTHDAY=32"],
    ["BYMONTHDAY zero", "FREQ=MONTHLY;BYMONTHDAY=0"],
    ["BYMONTH out of range", "FREQ=YEARLY;BYMONTH=13"],
    ["a BYDAY ordinal out of range", "FREQ=MONTHLY;BYDAY=54MO"],
    ["an unknown WKST", "FREQ=WEEKLY;WKST=XX"],
    ["a repeated key", "FREQ=DAILY;INTERVAL=1;INTERVAL=2"],
    ["a second FREQ", "FREQ=DAILY;FREQ=SECONDLY"],
    ["lower-case keys", "FREQ=DAILY;bysecond=0,1"],
    ["an oversized rule", `FREQ=WEEKLY;BYDAY=${"MO,".repeat(200)}MO`],
  ])("rejects %s with 400", (_label, rule) => {
    expect(() => assertValidRRule(rule, DTSTART)).toThrow(BadRequestException);
  });
});

describe("expandRRuleForRange — bounded expansion (regression H1)", () => {
  const dtstart = new Date("2025-01-06T10:00:00Z");
  const timezone = "America/Sao_Paulo";

  it("does not hit the cap for a daily rule over 366 days", () => {
    const occurrences = expandRRuleForRange(
      "FREQ=DAILY",
      dtstart,
      timezone,
      dtstart,
      new Date(dtstart.getTime() + 366 * 86_400_000),
    );

    expect(occurrences).toHaveLength(367);
    expect(occurrences.length).toBeLessThan(MAX_OCCURRENCES_PER_EXPANSION);
  });

  it("fails loudly instead of truncating when a rule yields more than the cap", () => {
    expect(() =>
      expandRRuleForRange(
        "FREQ=DAILY",
        dtstart,
        timezone,
        dtstart,
        new Date("2035-01-06T10:00:00Z"),
      ),
    ).toThrow(RRuleExpansionLimitError);
  });

  it("refuses a stored rule outside the whitelist before expanding it", () => {
    const started = Date.now();

    expect(() =>
      expandRRuleForRange(
        "FREQ=DAILY;BYHOUR=0,1,2,3;BYMINUTE=0,1,2,3;BYSECOND=0,1,2,3",
        dtstart,
        timezone,
        dtstart,
        new Date("2025-04-08T10:00:00Z"),
      ),
    ).toThrow(/BYHOUR/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("refuses a rule whose DTSTART is in an absurd year (the walk from DTSTART is unbounded)", () => {
    expect(() =>
      expandRRuleForRange(
        "FREQ=DAILY",
        new Date("0100-01-01T00:00:00Z"),
        timezone,
        new Date("2025-01-01T00:00:00Z"),
        new Date("2025-01-31T00:00:00Z"),
      ),
    ).toThrow(/DTSTART/);
  });
});

describe("assertValidRRule — DTSTART and reachability (regression H1)", () => {
  it.each(["0100-01-01T00:00:00Z", "9999-01-01T00:00:00Z"])(
    "rejects a rule starting in the absurd year of %s with 400",
    (dtstart) => {
      expect(() => assertValidRRule("FREQ=DAILY", new Date(dtstart))).toThrow(
        BadRequestException,
      );
    },
  );

  it.each([
    ["ends before it starts", "FREQ=DAILY;UNTIL=20230101T000000Z"],
    [
      "names a day its months never have",
      "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
    ],
  ])(
    "rejects a rule that %s with 400, without walking the years",
    (_label, rule) => {
      const started = Date.now();

      expect(() => assertValidRRule(rule, DTSTART)).toThrow(
        BadRequestException,
      );
      expect(Date.now() - started).toBeLessThan(500);
    },
  );
});
