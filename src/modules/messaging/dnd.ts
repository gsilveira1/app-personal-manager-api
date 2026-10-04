import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
import { DEFAULT_DND, DndConfig } from "../../common/types";

function isInsideWindow(hour: number, startHour: number, endHour: number) {
  if (startHour > endHour) {
    // Overnight window (e.g. 22:00 to 08:00)
    return hour >= startHour || hour < endHour;
  }
  // Same-day window (e.g. 13:00 to 15:00); equal hours mean "no window"
  return startHour < endHour && hour >= startHour && hour < endHour;
}

/**
 * How long a message requested at `nowUtc` must wait for the trainer's
 * do-not-disturb window to end. Applied once, as the BullMQ job delay.
 *
 * @param nowUtc - Instant of the enqueue call
 * @param config - The trainer's `settings.dnd` (defaults: 22h-08h America/Sao_Paulo)
 * @returns 0 when the message may go out now, otherwise the wait in milliseconds
 *
 * @example
 * calculateDndDelayMs(new Date("2026-09-20T05:30:00Z")) // 02:30 BRT → 19_800_000
 */
export function calculateDndDelayMs(
  nowUtc: Date = new Date(),
  config: Partial<DndConfig> = DEFAULT_DND,
): number {
  if (!(config.enabled ?? DEFAULT_DND.enabled)) {
    return 0;
  }
  const startHour = config.startHour ?? DEFAULT_DND.startHour;
  const endHour = config.endHour ?? DEFAULT_DND.endHour;
  const timezone = config.timezone || DEFAULT_DND.timezone;

  const zonedNow = utcToZonedTime(nowUtc, timezone);
  const hour = zonedNow.getHours();
  if (!isInsideWindow(hour, startHour, endHour)) {
    return 0;
  }

  const targetZoned = new Date(zonedNow);
  if (startHour > endHour && hour >= startHour) {
    targetZoned.setDate(targetZoned.getDate() + 1);
  }
  targetZoned.setHours(endHour, 0, 0, 0);

  const targetUtc = zonedTimeToUtc(targetZoned, timezone);
  return Math.max(0, targetUtc.getTime() - nowUtc.getTime());
}
