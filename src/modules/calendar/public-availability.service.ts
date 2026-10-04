import { Inject, Injectable } from "@nestjs/common";

import { USER_DIRECTORY, UserDirectory } from "../../common/ports";
import {
  DaySchedule,
  WeekDay,
  WorkHoursConfig,
} from "../../common/types/user-settings";
import { AvailableSlot, MS_PER_MINUTE } from "./calendar.types";
import {
  BusyTime,
  ConflictDetectorService,
  findSlotConflict,
} from "./conflict-detector.service";
import { DateRange } from "./date-range";

/** Index = `Date#getDay()` (0 = Sunday). */
const DAY_KEYS: readonly WeekDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const toMinutes = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
};

const pad = (value: number) => String(value).padStart(2, "0");

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Free slots of one day. A slot is offered every `slotDuration` minutes from the day's
 * start; it must end by the day's end, except the slot that starts exactly at the end
 * time, which is offered too (07:00–19:00 with 60 min yields 07:00 … 19:00).
 */
function freeSlotsOfDay(
  day: Date,
  schedule: DaySchedule,
  slotDuration: number,
  busy: BusyTime,
): AvailableSlot[] {
  if (!schedule.enabled) return [];
  const dayEnd = toMinutes(schedule.end);
  const slots: AvailableSlot[] = [];

  for (
    let mins = toMinutes(schedule.start);
    mins <= dayEnd;
    mins += slotDuration
  ) {
    if (mins + slotDuration > dayEnd && mins !== dayEnd) continue;

    const hour = Math.floor(mins / 60);
    const minute = mins % 60;
    const start = new Date(day);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + slotDuration * MS_PER_MINUTE);
    if (findSlotConflict({ start, end }, busy)) continue;

    slots.push({
      date: start.toISOString().split("T")[0],
      time: `${pad(hour)}:${pad(minute)}`,
      type: "In-Person",
      available: true,
    });
  }
  return slots;
}

/**
 * Free slots of every day in the range, from the trainer's work hours minus what is busy.
 *
 * @example
 * buildAvailableSlots({ start, end }, settings.workHours, busy)
 */
export function buildAvailableSlots(
  range: DateRange,
  workHours: WorkHoursConfig,
  busy: BusyTime,
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const current = new Date(range.start);

  while (current <= range.end) {
    slots.push(
      ...freeSlotsOfDay(
        current,
        workHours[DAY_KEYS[current.getDay()]],
        workHours.slotDurationMinutes,
        busy,
      ),
    );
    current.setDate(current.getDate() + 1);
  }
  return slots;
}

/** Public slot search for the website. Privacy-safe: exposes free slots, never clients. */
@Injectable()
export class PublicAvailabilityService {
  constructor(
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    private readonly conflicts: ConflictDetectorService,
  ) {}

  /**
   * @example
   * await availability.findAvailableSlots("ana-silva", { start, end });
   *
   * @throws {NotFoundException} When no trainer has that slug
   */
  async findAvailableSlots(
    slug: string,
    range: DateRange,
  ): Promise<AvailableSlot[]> {
    const trainer = await this.users.requireBySlug(slug);
    const { workHours } = await this.users.getSettings(trainer.id);

    // Slots are generated for whole days, so what is busy must cover whole days too.
    const busyUntil = new Date(
      endOfDay(range.end).getTime() +
        workHours.slotDurationMinutes * MS_PER_MINUTE,
    );
    const busy = await this.conflicts.loadBusy(
      trainer.id,
      startOfDay(range.start),
      busyUntil,
    );

    return buildAvailableSlots(range, workHours, busy);
  }
}
