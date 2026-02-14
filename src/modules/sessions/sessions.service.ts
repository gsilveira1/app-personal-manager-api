import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { addDays, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto, UpdateSessionDto } from './sessions.dto';
import { Session } from '@prisma/client';

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) { }

  async create(userId: string, data: CreateSessionDto) {
    // Validar se o cliente pertence ao user? (Opcional, mas boa prática)
    const client = await this.prisma.client.findUnique({ where: { id: data.clientId } });
    if (client && client.userId !== userId) throw new ForbiddenException('Cliente inválido');

    return this.prisma.session.create({
      data: { ...data, userId }
    });
  }

  async createRecurring(
    userId: string,
    baseSessionData: Omit<CreateSessionDto, 'date' | 'startDateStr' | 'frequency' | 'untilDateStr'>,
    startDateStr: string,
    frequency: 'weekly' | 'bi-weekly',
    untilDateStr: string,
  ) {
    const sessionsToCreate = [];
    const recurrenceId = `rec-${uuidv4()}`;

    let currentDate = parseISO(startDateStr);
    const untilDate = parseISO(untilDateStr);
    const increment = frequency === 'weekly' ? 7 : 14;

    while (currentDate <= untilDate) {
      sessionsToCreate.push({
        ...baseSessionData,
        date: currentDate,
        recurrenceId,
        completed: false,
        userId, // Importante
      });
      currentDate = addDays(currentDate, increment);
    }

    return this.prisma.$transaction(
      sessionsToCreate.map((session) =>
        this.prisma.session.create({ data: session })
      )
    );
  }

  async findAll(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      include: {
        client: { select: { name: true, avatar: true } },
        workout: { select: { title: true } }
      },
      orderBy: { date: 'asc' }
    });
  }

  async findOne(userId: string, id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session #${id} not found`);
    if (session.userId !== userId) throw new ForbiddenException();
    return session;
  }

  async updateWithScope(
    userId: string,
    id: string,
    data: UpdateSessionDto,
    scope: 'single' | 'future'
  ) {
    const targetSession = await this.findOne(userId, id);

    if (scope === 'single' || !targetSession.recurrenceId) {
      return this.prisma.session.update({
        where: { id },
        data,
      });
    }

    if (scope === 'future') {
      const originalDate = targetSession.date;

      const futureSessions = await this.prisma.session.findMany({
        where: {
          recurrenceId: targetSession.recurrenceId,
          date: { gte: originalDate },
          userId, // Garante escopo
        },
      });

      let timeDiff = 0;
      if (data.date) {
        const newDate = new Date(data.date);
        timeDiff = newDate.getTime() - originalDate.getTime();
      }

      return this.prisma.$transaction(
        futureSessions.map((session: Session) => {
          const updatePayload: any = { ...data };
          if (timeDiff !== 0) {
            updatePayload.date = new Date(session.date.getTime() + timeDiff);
          }
          return this.prisma.session.update({
            where: { id: session.id },
            data: updatePayload,
          });
        })
      );
    }
  }

  async toggleComplete(userId: string, id: string) {
    const session = await this.findOne(userId, id);
    return this.prisma.session.update({
      where: { id },
      data: { completed: !session.completed },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.session.delete({ where: { id } });
  }
}