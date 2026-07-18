import { expandRRuleForRange } from './rrule-expander';

describe('expandRRuleForRange', () => {
  const timezone = 'America/Sao_Paulo';

  it('should expand weekly RRULE into correct occurrences', () => {
    const dtstart = new Date('2025-01-06T10:00:00Z'); // Monday
    const rangeStart = new Date('2025-01-01T00:00:00Z');
    const rangeEnd = new Date('2025-01-31T23:59:59Z');

    const occurrences = expandRRuleForRange(
      'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
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

  it('should respect exdates', () => {
    const dtstart = new Date('2025-01-06T10:00:00Z');
    const rangeStart = new Date('2025-01-01T00:00:00Z');
    const rangeEnd = new Date('2025-01-31T23:59:59Z');

    const occurrences = expandRRuleForRange(
      'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
      [new Date('2025-01-13T10:00:00Z')],
    );

    expect(occurrences).toHaveLength(3);
    const dates = occurrences.map((d) => d.getDate());
    expect(dates).not.toContain(13);
  });

  it('should return empty array for range with no occurrences', () => {
    const dtstart = new Date('2025-03-01T10:00:00Z');
    const rangeStart = new Date('2025-01-01T00:00:00Z');
    const rangeEnd = new Date('2025-01-31T23:59:59Z');

    const occurrences = expandRRuleForRange(
      'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
    );

    expect(occurrences).toHaveLength(0);
  });

  it('should handle daily frequency', () => {
    const dtstart = new Date('2025-01-06T08:00:00Z');
    const rangeStart = new Date('2025-01-06T00:00:00Z');
    const rangeEnd = new Date('2025-01-08T23:59:59Z');

    const occurrences = expandRRuleForRange(
      'FREQ=DAILY;COUNT=5',
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
    );

    expect(occurrences).toHaveLength(3); // Jan 6, 7, 8
  });

  it('should handle multiple BYDAY values', () => {
    const dtstart = new Date('2025-01-06T10:00:00Z'); // Monday
    const rangeStart = new Date('2025-01-06T00:00:00Z');
    const rangeEnd = new Date('2025-01-12T23:59:59Z'); // One week

    const occurrences = expandRRuleForRange(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      dtstart,
      timezone,
      rangeStart,
      rangeEnd,
    );

    // Mon Jan 6, Wed Jan 8, Fri Jan 10
    expect(occurrences).toHaveLength(3);
  });
});
