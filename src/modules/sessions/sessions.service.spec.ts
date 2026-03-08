import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SessionsService', () => {
  let service: SessionsService;
  let prisma: any;

  const userId = 'trainer-uuid-1';
  const clientId = 'client-uuid-1';
  const sessionId = 'session-uuid-1';

  const mockSession = {
    id: sessionId,
    date: new Date('2025-02-01T10:00:00Z'),
    durationMinutes: 60,
    type: 'In-Person',
    category: 'Workout',
    completed: false,
    notes: null,
    recurrenceId: null,
    clientId,
    userId,
    linkedWorkoutId: null,
  };

  const mockClient = {
    id: clientId,
    userId,
    name: 'Maria Santos',
  };

  beforeEach(async () => {
    prisma = {
      session: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      client: {
        findUnique: jest.fn(),
      },
      recurringEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      sessionException: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════
  // LEGACY single-instance
  // ═══════════════════════════════════

  describe('create', () => {
    it('should create a single session', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.session.create.mockResolvedValue(mockSession);

      const dto = {
        date: '2025-02-01T10:00:00Z',
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        clientId,
      };
      const result = await service.create(userId, dto as any);

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: { ...dto, userId },
      });
      expect(result.id).toBe(sessionId);
    });

    it('should throw ForbiddenException when client belongs to another user', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, userId: 'other-user' });

      await expect(
        service.create(userId, { clientId, date: '2025-02-01', durationMinutes: 60, type: 'In-Person', category: 'Workout' } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createRecurring (legacy)', () => {
    it('should create multiple sessions with shared recurrenceId (weekly)', async () => {
      prisma.session.create.mockImplementation((args: any) => Promise.resolve({ id: 'new-id', ...args.data }));

      const baseData = { durationMinutes: 60, type: 'In-Person', category: 'Workout', clientId };
      const result = await service.createRecurring(userId, baseData as any, '2025-01-06', 'weekly', '2025-01-20');

      // 3 weeks: Jan 6, 13, 20
      expect(prisma.session.create).toHaveBeenCalledTimes(3);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should create sessions with bi-weekly frequency', async () => {
      prisma.session.create.mockImplementation((args: any) => Promise.resolve({ id: 'new-id', ...args.data }));

      const baseData = { durationMinutes: 60, type: 'In-Person', category: 'Workout', clientId };
      const result = await service.createRecurring(userId, baseData as any, '2025-01-06', 'bi-weekly', '2025-02-03');

      // Jan 6, Jan 20, Feb 3
      expect(prisma.session.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('findAll', () => {
    it('should return all sessions for user', async () => {
      prisma.session.findMany.mockResolvedValue([mockSession]);

      const result = await service.findAll(userId);

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: {
          client: { select: { name: true, avatar: true } },
          workout: { select: { title: true } },
        },
        orderBy: { date: 'asc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return session when found and owned', async () => {
      prisma.session.findUnique.mockResolvedValue(mockSession);

      const result = await service.findOne(userId, sessionId);
      expect(result.id).toBe(sessionId);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when session belongs to another user', async () => {
      prisma.session.findUnique.mockResolvedValue({ ...mockSession, userId: 'other-user' });

      await expect(service.findOne(userId, sessionId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateWithScope', () => {
    it('should update single session when scope is single', async () => {
      prisma.session.findUnique.mockResolvedValue(mockSession);
      prisma.session.update.mockResolvedValue({ ...mockSession, notes: 'Updated' });

      const result = await service.updateWithScope(userId, sessionId, { notes: 'Updated' } as any, 'single');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: { notes: 'Updated' },
      });
    });

    it('should update single session when no recurrenceId (even with scope future)', async () => {
      prisma.session.findUnique.mockResolvedValue({ ...mockSession, recurrenceId: null });
      prisma.session.update.mockResolvedValue({ ...mockSession, notes: 'Updated' });

      await service.updateWithScope(userId, sessionId, { notes: 'Updated' } as any, 'future');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: { notes: 'Updated' },
      });
    });

    it('should update all future sessions when scope is future and has recurrenceId', async () => {
      const recurrenceId = 'rec-123';
      const targetSession = { ...mockSession, recurrenceId, date: new Date('2025-02-01T10:00:00Z') };
      const futureSession = { ...mockSession, id: 'session-2', recurrenceId, date: new Date('2025-02-08T10:00:00Z') };

      prisma.session.findUnique.mockResolvedValue(targetSession);
      prisma.session.findMany.mockResolvedValue([targetSession, futureSession]);
      prisma.session.update.mockImplementation((args: any) => Promise.resolve({ id: args.where.id, notes: 'Updated' }));

      await service.updateWithScope(userId, sessionId, { notes: 'Updated' } as any, 'future');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: {
          recurrenceId,
          date: { gte: targetSession.date },
          userId,
        },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('toggleComplete', () => {
    it('should flip completed from false to true', async () => {
      prisma.session.findUnique.mockResolvedValue({ ...mockSession, completed: false });
      prisma.session.update.mockResolvedValue({ ...mockSession, completed: true });

      const result = await service.toggleComplete(userId, sessionId);

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: { completed: true },
      });
    });

    it('should flip completed from true to false', async () => {
      prisma.session.findUnique.mockResolvedValue({ ...mockSession, completed: true });
      prisma.session.update.mockResolvedValue({ ...mockSession, completed: false });

      const result = await service.toggleComplete(userId, sessionId);

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: { completed: false },
      });
    });
  });

  describe('remove', () => {
    it('should delete session after ownership check', async () => {
      prisma.session.findUnique.mockResolvedValue(mockSession);
      prisma.session.delete.mockResolvedValue(mockSession);

      await service.remove(userId, sessionId);

      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: sessionId } });
    });
  });

  // ═══════════════════════════════════
  // RRULE-based Recurrence
  // ═══════════════════════════════════

  describe('createRecurringEvent', () => {
    it('should create a recurring event master record', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      const createdEvent = { id: 'event-1', rrule: 'FREQ=WEEKLY;BYDAY=MO', timezone: 'America/Sao_Paulo' };
      prisma.recurringEvent.create.mockResolvedValue(createdEvent);

      const dto = {
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        timezone: 'America/Sao_Paulo',
        dtstart: '2025-01-06T10:00:00Z',
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        clientId,
      };

      const result = await service.createRecurringEvent(userId, dto as any);

      expect(prisma.recurringEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          userId,
          clientId,
        }),
      });
      expect(result.id).toBe('event-1');
    });

    it('should throw ForbiddenException when client belongs to another user', async () => {
      prisma.client.findUnique.mockResolvedValue({ ...mockClient, userId: 'other-user' });

      const dto = {
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        timezone: 'America/Sao_Paulo',
        dtstart: '2025-01-06T10:00:00Z',
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        clientId,
      };

      await expect(service.createRecurringEvent(userId, dto as any)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      const dto = {
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        timezone: 'America/Sao_Paulo',
        dtstart: '2025-01-06T10:00:00Z',
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        clientId: 'non-existent',
      };

      await expect(service.createRecurringEvent(userId, dto as any)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('materializeRecurringSessionsForRange', () => {
    it('should expand RRULE into virtual sessions within range', async () => {
      const event = {
        id: 'event-1',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
        timezone: 'America/Sao_Paulo',
        dtstart: new Date('2025-01-06T10:00:00Z'), // Monday
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        notes: 'Treino A',
        clientId,
        userId,
        linkedWorkoutId: null,
        exceptions: [],
      };
      prisma.recurringEvent.findMany.mockResolvedValue([event]);

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const result = await service.materializeRecurringSessionsForRange(userId, rangeStart, rangeEnd);

      // Should have 4 Mondays in January: 6, 13, 20, 27
      expect(result.length).toBe(4);
      expect(result[0].isVirtual).toBe(true);
      expect(result[0].recurringEventId).toBe('event-1');
      expect(result[0].durationMinutes).toBe(60);
      expect(result[0].cancelled).toBe(false);
    });

    it('should apply cancelled exceptions (exclude dates)', async () => {
      const event = {
        id: 'event-1',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
        dtstart: new Date('2025-01-06T10:00:00Z'),
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        notes: null,
        clientId,
        userId,
        linkedWorkoutId: null,
        exceptions: [
          {
            id: 'exc-1',
            cancelled: true,
            originalStartTime: new Date('2025-01-13T10:00:00Z'),
            newStartTime: null,
            durationMinutes: null,
            notes: null,
            completed: false,
          },
        ],
      };
      prisma.recurringEvent.findMany.mockResolvedValue([event]);

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const result = await service.materializeRecurringSessionsForRange(userId, rangeStart, rangeEnd);

      // Jan 13 is cancelled, so only 3 sessions
      expect(result.length).toBe(3);
      const dates = result.map(s => new Date(s.date).getDate());
      expect(dates).not.toContain(13);
    });

    it('should apply rescheduled exceptions (non-cancelled with newStartTime)', async () => {
      const event = {
        id: 'event-1',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2',
        dtstart: new Date('2025-01-06T10:00:00Z'),
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        notes: null,
        clientId,
        userId,
        linkedWorkoutId: null,
        exceptions: [
          {
            id: 'exc-1',
            cancelled: false,
            originalStartTime: new Date('2025-01-06T10:00:00Z'),
            newStartTime: new Date('2025-01-07T14:00:00Z'),
            durationMinutes: 45,
            notes: 'Remarcado para terça',
            completed: true,
          },
        ],
      };
      prisma.recurringEvent.findMany.mockResolvedValue([event]);

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const result = await service.materializeRecurringSessionsForRange(userId, rangeStart, rangeEnd);

      expect(result).toHaveLength(2);
      // First occurrence should be rescheduled
      const rescheduled = result.find(s => s.exceptionId === 'exc-1');
      expect(rescheduled).toBeDefined();
      expect(new Date(rescheduled!.date).toISOString()).toBe('2025-01-07T14:00:00.000Z');
      expect(rescheduled!.durationMinutes).toBe(45);
      expect(rescheduled!.notes).toBe('Remarcado para terça');
      expect(rescheduled!.completed).toBe(true);
    });

    it('should return empty array when no recurring events', async () => {
      prisma.recurringEvent.findMany.mockResolvedValue([]);

      const result = await service.materializeRecurringSessionsForRange(userId, new Date(), new Date());
      expect(result).toEqual([]);
    });

    it('should skip malformed RRULE strings gracefully', async () => {
      const event = {
        id: 'event-bad',
        rrule: 'INVALID_RRULE_STRING',
        dtstart: new Date('2025-01-06T10:00:00Z'),
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        notes: null,
        clientId,
        userId,
        linkedWorkoutId: null,
        exceptions: [],
      };
      prisma.recurringEvent.findMany.mockResolvedValue([event]);

      const result = await service.materializeRecurringSessionsForRange(
        userId, new Date('2025-01-01'), new Date('2025-01-31'),
      );
      // Should skip the malformed event and return empty
      expect(result).toEqual([]);
    });
  });

  describe('upsertSessionException', () => {
    it('should upsert a session exception for cancellation', async () => {
      const event = { id: 'event-1', userId };
      prisma.recurringEvent.findUnique.mockResolvedValue(event);
      prisma.sessionException.upsert.mockResolvedValue({ id: 'exc-1', cancelled: true });

      const dto = {
        recurringEventId: 'event-1',
        originalStartTime: '2025-01-13T10:00:00Z',
        cancelled: true,
      };

      const result = await service.upsertSessionException(userId, dto as any);

      expect(prisma.sessionException.upsert).toHaveBeenCalledWith({
        where: {
          recurringEventId_originalStartTime: {
            recurringEventId: 'event-1',
            originalStartTime: new Date('2025-01-13T10:00:00Z'),
          },
        },
        create: expect.objectContaining({ cancelled: true }),
        update: expect.objectContaining({ cancelled: true }),
      });
      expect(result.cancelled).toBe(true);
    });

    it('should throw NotFoundException when recurring event does not exist', async () => {
      prisma.recurringEvent.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertSessionException(userId, { recurringEventId: 'non-existent', originalStartTime: '2025-01-13T10:00:00Z' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when event belongs to another user', async () => {
      prisma.recurringEvent.findUnique.mockResolvedValue({ id: 'event-1', userId: 'other-user' });

      await expect(
        service.upsertSessionException(userId, { recurringEventId: 'event-1', originalStartTime: '2025-01-13T10:00:00Z' } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeRecurringEvent', () => {
    it('should delete entire recurring series', async () => {
      prisma.recurringEvent.findUnique.mockResolvedValue({ id: 'event-1', userId });
      prisma.recurringEvent.delete.mockResolvedValue({ id: 'event-1' });

      await service.removeRecurringEvent(userId, 'event-1');

      expect(prisma.recurringEvent.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
    });

    it('should throw NotFoundException when event does not exist', async () => {
      prisma.recurringEvent.findUnique.mockResolvedValue(null);

      await expect(service.removeRecurringEvent(userId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when event belongs to another user', async () => {
      prisma.recurringEvent.findUnique.mockResolvedValue({ id: 'event-1', userId: 'other-user' });

      await expect(service.removeRecurringEvent(userId, 'event-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ═══════════════════════════════════
  // Combined calendar views
  // ═══════════════════════════════════

  describe('findAllForRange', () => {
    it('should merge legacy sessions and virtual sessions', async () => {
      prisma.session.findMany.mockResolvedValue([mockSession]);
      prisma.recurringEvent.findMany.mockResolvedValue([]);

      const result = await service.findAllForRange(userId, new Date('2025-01-01'), new Date('2025-03-01'));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(sessionId);
    });

    it('should gracefully handle P2021 (table not exist) error', async () => {
      prisma.session.findMany.mockResolvedValue([mockSession]);
      prisma.recurringEvent.findMany.mockRejectedValue({ code: 'P2021' });

      const result = await service.findAllForRange(userId, new Date('2025-01-01'), new Date('2025-03-01'));

      // Should still return legacy sessions
      expect(result).toHaveLength(1);
    });
  });

  describe('findAvailableSlots', () => {
    it('should return available 60-min slots Mon-Sat 07:00-19:00', async () => {
      prisma.session.findMany.mockResolvedValue([]);
      prisma.recurringEvent.findMany.mockResolvedValue([]);

      // Query a single Monday (use local date to avoid timezone issues)
      const monday = new Date(2025, 0, 6); // Jan 6, 2025 = Monday
      const result = await service.findAvailableSlots(userId, monday, monday);

      // 13 slots: 07:00 to 19:00
      expect(result.length).toBe(13);
      expect(result[0].time).toBe('07:00');
      expect(result[result.length - 1].time).toBe('19:00');
      expect(result.every((s: any) => s.available)).toBe(true);
    });

    it('should exclude occupied slots', async () => {
      const occupiedDate = new Date(2025, 0, 6); // Monday
      occupiedDate.setHours(10, 0, 0, 0);
      prisma.session.findMany.mockResolvedValue([
        { date: occupiedDate, durationMinutes: 60, type: 'In-Person', completed: false },
      ]);
      prisma.recurringEvent.findMany.mockResolvedValue([]);

      const monday = new Date(2025, 0, 6);
      const result = await service.findAvailableSlots(userId, monday, monday);

      // 10:00 slot should be excluded
      const times = result.map((s: any) => s.time);
      expect(times).not.toContain('10:00');
      expect(result.length).toBe(12);
    });

    it('should skip Sundays', async () => {
      prisma.session.findMany.mockResolvedValue([]);
      prisma.recurringEvent.findMany.mockResolvedValue([]);

      // Sunday Jan 5 (use local date)
      const sunday = new Date(2025, 0, 5); // Jan 5, 2025 = Sunday
      const result = await service.findAvailableSlots(userId, sunday, sunday);

      expect(result).toEqual([]);
    });
  });
});
