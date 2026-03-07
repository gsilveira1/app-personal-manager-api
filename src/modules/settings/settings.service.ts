import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const AI_KEY = 'ai_prompt_instructions';
const LANGUAGE_KEY = 'preferred_language';

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
}