import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { isPlainObject, validateDocument } from "./json-validation";

/** Document stored in `User.settings` (JSONB). Every key is optional; see {@link resolveUserSettings}. */
export interface UserSettings {
  /** Custom instructions appended to AI workout prompts (was UserSetting "ai_prompt_instructions"). */
  aiInstructions?: string;
  /** UI language (was UserSetting "preferred_language"). */
  language?: SupportedLanguage;
  /** Weekly availability used by the public slot search (was UserSetting "work_hours"). */
  workHours?: WorkHoursConfig;
  /** Do-not-disturb window for outbound messages (was Tenant.features.dnd*). */
  dnd?: DndConfig;
  /** Account limits, written by admins only (was Tenant.features). */
  limits?: AccountLimits;
}

export type ResolvedUserSettings = Required<UserSettings>;

export const SUPPORTED_LANGUAGES = ["pt-BR", "en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface DaySchedule {
  enabled: boolean;
  /** "HH:mm", 24h */
  start: string;
  /** "HH:mm", 24h */
  end: string;
}

export const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export type WorkHoursConfig = Record<WeekDay, DaySchedule> & {
  slotDurationMinutes: number;
};

export interface DndConfig {
  enabled: boolean;
  /** 0-23, hour the silence window starts, in `timezone`. */
  startHour: number;
  /** 0-23, hour the silence window ends, in `timezone`. */
  endHour: number;
  /** IANA zone, e.g. "America/Sao_Paulo". */
  timezone: string;
}

export interface AccountLimits {
  maxStudents: number;
  canUploadVideos: boolean;
  whatsappAlerts: boolean;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_HOURS: DaySchedule = {
  enabled: true,
  start: "07:00",
  end: "19:00",
};

export const DEFAULT_WORK_HOURS: WorkHoursConfig = {
  monday: WEEKDAY_HOURS,
  tuesday: WEEKDAY_HOURS,
  wednesday: WEEKDAY_HOURS,
  thursday: WEEKDAY_HOURS,
  friday: WEEKDAY_HOURS,
  saturday: WEEKDAY_HOURS,
  sunday: { enabled: false, start: "08:00", end: "12:00" },
  slotDurationMinutes: 60,
};

export const DEFAULT_DND: DndConfig = {
  enabled: true,
  startHour: 22,
  endHour: 8,
  timezone: "America/Sao_Paulo",
};

export const DEFAULT_ACCOUNT_LIMITS: AccountLimits = {
  maxStudents: 50,
  canUploadVideos: true,
  whatsappAlerts: true,
};

export const DEFAULT_USER_SETTINGS: ResolvedUserSettings = {
  aiInstructions: "",
  language: "pt-BR",
  workHours: DEFAULT_WORK_HOURS,
  dnd: DEFAULT_DND,
  limits: DEFAULT_ACCOUNT_LIMITS,
};

export class DayScheduleDto implements DaySchedule {
  @IsBoolean()
  enabled!: boolean;

  @Matches(HH_MM, { message: "start must be HH:mm" })
  start!: string;

  @Matches(HH_MM, { message: "end must be HH:mm" })
  end!: string;
}

export class WorkHoursDto implements WorkHoursConfig {
  @ValidateNested() @Type(() => DayScheduleDto) monday!: DayScheduleDto;
  @ValidateNested() @Type(() => DayScheduleDto) tuesday!: DayScheduleDto;
  @ValidateNested() @Type(() => DayScheduleDto) wednesday!: DayScheduleDto;
  @ValidateNested() @Type(() => DayScheduleDto) thursday!: DayScheduleDto;
  @ValidateNested() @Type(() => DayScheduleDto) friday!: DayScheduleDto;
  @ValidateNested() @Type(() => DayScheduleDto) saturday!: DayScheduleDto;
  @ValidateNested() @Type(() => DayScheduleDto) sunday!: DayScheduleDto;

  @IsInt()
  @Min(15)
  @Max(120)
  slotDurationMinutes!: number;
}

export class DndConfigDto implements DndConfig {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(23)
  startHour!: number;

  @IsInt()
  @Min(0)
  @Max(23)
  endHour!: number;

  @IsString()
  @MaxLength(64)
  timezone!: string;
}

export class AccountLimitsDto implements AccountLimits {
  @IsInt()
  @Min(0)
  maxStudents!: number;

  @IsBoolean()
  canUploadVideos!: boolean;

  @IsBoolean()
  whatsappAlerts!: boolean;
}

export class UserSettingsDto implements UserSettings {
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  aiInstructions?: string;

  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: SupportedLanguage;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkHoursDto)
  workHours?: WorkHoursDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DndConfigDto)
  dnd?: DndConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AccountLimitsDto)
  limits?: AccountLimitsDto;
}

/**
 * Validates a whole settings document before it is written to `User.settings`.
 *
 * @throws {BadRequestException} On unknown keys or invalid values
 *
 * @example
 * const settings = parseUserSettings({ language: "en" });
 */
export function parseUserSettings(plain: unknown): UserSettings {
  return validateDocument(UserSettingsDto, plain, "User.settings");
}

/**
 * Applies a partial change to the stored document and validates the result.
 * Top-level keys are replaced, not deep-merged.
 *
 * @param stored - Current value of `User.settings` (may be null)
 * @param patch - Keys to replace
 * @returns The document to persist
 * @throws {BadRequestException} When the merged document is invalid
 *
 * @example
 * const next = mergeUserSettings(user.settings, { language: "es" });
 */
export function mergeUserSettings(
  stored: unknown,
  patch: UserSettings,
): UserSettings {
  const current = isPlainObject(stored) ? stored : {};
  return parseUserSettings({ ...current, ...patch });
}

/**
 * Reads `User.settings` and fills every missing key with its default, so callers
 * never branch on absent settings.
 *
 * @param stored - Raw column value (null for accounts that never saved settings)
 *
 * @example
 * resolveUserSettings(null).language // "pt-BR"
 */
export function resolveUserSettings(stored: unknown): ResolvedUserSettings {
  const raw = (isPlainObject(stored) ? stored : {}) as UserSettings;
  return {
    aiInstructions: raw.aiInstructions ?? DEFAULT_USER_SETTINGS.aiInstructions,
    language: raw.language ?? DEFAULT_USER_SETTINGS.language,
    workHours: { ...DEFAULT_WORK_HOURS, ...(raw.workHours ?? {}) },
    dnd: { ...DEFAULT_DND, ...(raw.dnd ?? {}) },
    limits: { ...DEFAULT_ACCOUNT_LIMITS, ...(raw.limits ?? {}) },
  };
}
