import { RRuleSet, rrulestr } from 'rrule';

/**
 * Expand an RRULE string into occurrence dates within a given range.
 *
 * @param rrule - RFC 5545 RRULE string (e.g. "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12")
 * @param dtstart - The DTSTART of the rule
 * @param timezone - TZID for expansion (currently unused by rrule.js but kept for forward-compat)
 * @param rangeStart - Start of the query window (inclusive)
 * @param rangeEnd - End of the query window (inclusive)
 * @param exdates - Dates to exclude from the expansion (e.g. cancelled occurrences)
 * @returns Array of occurrence dates within the range
 */
export function expandRRuleForRange(
  rrule: string,
  dtstart: Date,
  timezone: string,
  rangeStart: Date,
  rangeEnd: Date,
  exdates: Date[] = [],
): Date[] {
  const dtstartISO = dtstart
    .toISOString()
    .replace(/[-:]/g, '')
    .split('.')[0] + 'Z';

  const ruleSet = rrulestr(
    `DTSTART:${dtstartISO}\nRRULE:${rrule}`,
    { forceset: true },
  ) as RRuleSet;

  for (const exdate of exdates) {
    ruleSet.exdate(new Date(exdate));
  }

  return ruleSet.between(rangeStart, rangeEnd, true);
}
