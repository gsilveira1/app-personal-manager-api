import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const AI_KEY = 'ai_prompt_instructions';
const LANGUAGE_KEY = 'preferred_language';
const WORK_HOURS_KEY = 'work_hours';

export interface DaySchedule {
  enabled: boolean;
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
}

export interface WorkHoursConfig {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
  slotDurationMinutes: number;
}

const DEFAULT_WORK_HOURS: WorkHoursConfig = {
  monday:    { enabled: true, start: '07:00', end: '19:00' },
  tuesday:   { enabled: true, start: '07:00', end: '19:00' },
  wednesday: { enabled: true, start: '07:00', end: '19:00' },
  thursday:  { enabled: true, start: '07:00', end: '19:00' },
  friday:    { enabled: true, start: '07:00', end: '19:00' },
  saturday:  { enabled: true, start: '07:00', end: '19:00' },
  sunday:    { enabled: false, start: '08:00', end: '12:00' },
  slotDurationMinutes: 60,
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getAiInstructions(userId: string) {
    // Busca pela chave composta (userId + key)
    const setting = await this.prisma.userSetting.findUnique({
      where: {
        userId_key: {
          userId,
          key: AI_KEY,
        },
      },
    });
    return { instructions: setting?.value || '' };
  }

  async updateAiInstructions(userId: string, instructions: string) {
    return this.prisma.userSetting.upsert({
      where: {
        userId_key: {
          userId,
          key: AI_KEY,
        },
      },
      update: { value: instructions },
      create: {
        userId,
        key: AI_KEY,
        value: instructions
      },
    });
  }

  async getLanguage(userId: string): Promise<{ language: string }> {
    const setting = await this.prisma.userSetting.findUnique({
      where: { userId_key: { userId, key: LANGUAGE_KEY } },
    });
    return { language: setting?.value ?? 'pt-BR' };
  }

  async updateLanguage(userId: string, language: string): Promise<{ language: string }> {
    const result = await this.prisma.userSetting.upsert({
      where: { userId_key: { userId, key: LANGUAGE_KEY } },
      update: { value: language },
      create: { userId, key: LANGUAGE_KEY, value: language },
    });
    return { language: result.value };
  }

  async getWorkHours(userId: string): Promise<WorkHoursConfig> {
    const setting = await this.prisma.userSetting.findUnique({
      where: { userId_key: { userId, key: WORK_HOURS_KEY } },
    });
    if (!setting) return DEFAULT_WORK_HOURS;
    try {
      return JSON.parse(setting.value) as WorkHoursConfig;
    } catch {
      return DEFAULT_WORK_HOURS;
    }
  }

  async updateWorkHours(userId: string, config: WorkHoursConfig): Promise<WorkHoursConfig> {
    const value = JSON.stringify(config);
    await this.prisma.userSetting.upsert({
      where: { userId_key: { userId, key: WORK_HOURS_KEY } },
      update: { value },
      create: { userId, key: WORK_HOURS_KEY, value },
    });
    return config;
  }
}