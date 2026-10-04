import { calculateDndDelayMs } from "./dnd";

describe("calculateDndDelayMs", () => {
  it("returns 0 when do-not-disturb is disabled, even at night", () => {
    // 02:30 BRT would normally be inside the window
    const night = new Date("2026-09-20T05:30:00.000Z");
    expect(calculateDndDelayMs(night, { enabled: false })).toBe(0);
  });

  it("returns 0 during daytime in America/Sao_Paulo (14:00 BRT)", () => {
    expect(calculateDndDelayMs(new Date("2026-09-20T17:00:00.000Z"))).toBe(0);
  });

  it("waits until 08:00 when requested at 02:30 BRT", () => {
    const night = new Date("2026-09-20T05:30:00.000Z");
    expect(calculateDndDelayMs(night)).toBe(5.5 * 3600 * 1000);
  });

  it("waits until 08:00 of the next morning when requested at 23:00 BRT", () => {
    const night = new Date("2026-09-20T02:00:00.000Z");
    expect(calculateDndDelayMs(night)).toBe(9 * 3600 * 1000);
  });

  it("respects a custom overnight window", () => {
    // 21:00 BRT
    const evening = new Date("2026-09-20T00:00:00.000Z");
    expect(calculateDndDelayMs(evening)).toBe(0);
    expect(
      calculateDndDelayMs(evening, {
        enabled: true,
        startHour: 20,
        endHour: 6,
      }),
    ).toBe(9 * 3600 * 1000);
  });

  it("handles a same-day window (13h-15h)", () => {
    const config = { enabled: true, startHour: 13, endHour: 15 };
    // 14:00 BRT → one hour left
    expect(
      calculateDndDelayMs(new Date("2026-09-20T17:00:00.000Z"), config),
    ).toBe(3600 * 1000);
    // 15:00 BRT → window is over
    expect(
      calculateDndDelayMs(new Date("2026-09-20T18:00:00.000Z"), config),
    ).toBe(0);
  });

  it("treats equal start and end hours as no window", () => {
    expect(
      calculateDndDelayMs(new Date("2026-09-20T05:30:00.000Z"), {
        enabled: true,
        startHour: 8,
        endHour: 8,
      }),
    ).toBe(0);
  });

  it("uses the configured timezone", () => {
    // 05:30 UTC is 05:30 in UTC (inside 22-08) → 2.5 h until 08:00 UTC
    expect(
      calculateDndDelayMs(new Date("2026-09-20T05:30:00.000Z"), {
        enabled: true,
        startHour: 22,
        endHour: 8,
        timezone: "UTC",
      }),
    ).toBe(2.5 * 3600 * 1000);
  });
});
