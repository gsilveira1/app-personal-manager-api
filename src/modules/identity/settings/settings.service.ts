import { BadRequestException, Injectable } from "@nestjs/common";
import {
  DndConfig,
  SupportedLanguage,
  WorkHoursConfig,
} from "../../../common/types";
import { definedOnly, UserSettingsStore } from "../user-settings.store";

/**
 * @throws {BadRequestException} When `timezone` is not an IANA zone the runtime knows
 */
function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BadRequestException(
        `timezone "${timezone}" is not a valid IANA time zone`,
      );
    }
    throw error;
  }
}

/** The trainer's own preferences, stored in `User.settings`. */
@Injectable()
export class SettingsService {
  constructor(private readonly store: UserSettingsStore) {}

  async getAiInstructions(userId: string): Promise<{ instructions: string }> {
    const { aiInstructions } = await this.store.read(userId);
    return { instructions: aiInstructions };
  }

  async updateAiInstructions(
    userId: string,
    instructions: string,
  ): Promise<{ instructions: string }> {
    const settings = await this.store.patch(userId, () => ({
      aiInstructions: instructions,
    }));
    return { instructions: settings.aiInstructions };
  }

  async getLanguage(userId: string): Promise<{ language: string }> {
    const { language } = await this.store.read(userId);
    return { language };
  }

  async updateLanguage(
    userId: string,
    language: SupportedLanguage,
  ): Promise<{ language: string }> {
    const settings = await this.store.patch(userId, () => ({ language }));
    return { language: settings.language };
  }

  async getWorkHours(userId: string): Promise<WorkHoursConfig> {
    return (await this.store.read(userId)).workHours;
  }

  async updateWorkHours(
    userId: string,
    workHours: WorkHoursConfig,
  ): Promise<WorkHoursConfig> {
    return (await this.store.patch(userId, () => ({ workHours }))).workHours;
  }

  /**
   * Merges the body over the current do-not-disturb window and stores the whole object.
   *
   * @throws {BadRequestException} When the time zone or an hour is invalid
   *
   * @example
   * await settingsService.updateDnd(userId, { startHour: 23 });
   */
  async updateDnd(
    userId: string,
    patch: Partial<DndConfig>,
  ): Promise<DndConfig> {
    if (patch.timezone !== undefined) assertTimezone(patch.timezone);
    const settings = await this.store.patch(userId, (current) => ({
      dnd: { ...current.dnd, ...definedOnly(patch) },
    }));
    return settings.dnd;
  }
}
