import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const AI_KEY = 'ai_prompt_instructions';

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
}