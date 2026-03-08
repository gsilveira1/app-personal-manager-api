import { Test, TestingModule } from '@nestjs/testing';

import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

describe('SessionsController', () => {
  let controller: SessionsController;
  let service: Record<string, jest.Mock>;

  const req = { user: { userId: 'trainer-uuid-1', email: 'trainer@test.com' } };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      createRecurring: jest.fn(),
      createRecurringEvent: jest.fn(),
      removeRecurringEvent: jest.fn(),
      upsertSessionException: jest.fn(),
      findAll: jest.fn(),
      findAllForRange: jest.fn(),
      findOne: jest.fn(),
      updateWithScope: jest.fn(),
      toggleComplete: jest.fn(),
      remove: jest.fn(),
      findAvailableSlots: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionsService, useValue: service },
      ],
    }).compile();

    controller = module.get<SessionsController>(SessionsController);
  });

  describe('POST / (create)', () => {
    it('should delegate to service.create with userId', async () => {
      const dto = { date: '2025-02-01', durationMinutes: 60, type: 'In-Person', category: 'Workout', clientId: 'c1' };
      service.create!.mockResolvedValue({ id: 'sess-1' } as any);

      await controller.create(req as any, dto as any);

      expect(service.create).toHaveBeenCalledWith('trainer-uuid-1', dto);
    });
  });

  describe('POST /recurring', () => {
    it('should delegate to service.createRecurring with correct params', async () => {
      const dto = {
        baseSession: { durationMinutes: 60, type: 'In-Person', category: 'Workout', clientId: 'c1' },
        startDateStr: '2025-01-06',
        frequency: 'weekly' as const,
        untilDateStr: '2025-02-03',
      };
      service.createRecurring!.mockResolvedValue([]);

      await controller.createRecurring(req as any, dto as any);

      expect(service.createRecurring).toHaveBeenCalledWith(
        'trainer-uuid-1',
        dto.baseSession,
        '2025-01-06',
        'weekly',
        '2025-02-03',
      );
    });
  });

  describe('POST /recurring-event', () => {
    it('should delegate to service.createRecurringEvent', async () => {
      const dto = { rrule: 'FREQ=WEEKLY;BYDAY=MO', timezone: 'America/Sao_Paulo', dtstart: '2025-01-06', durationMinutes: 60, type: 'In-Person', category: 'Workout', clientId: 'c1' };
      service.createRecurringEvent!.mockResolvedValue({ id: 'event-1' } as any);

      await controller.createRecurringEvent(req as any, dto as any);

      expect(service.createRecurringEvent).toHaveBeenCalledWith('trainer-uuid-1', dto);
    });
  });

  describe('GET / (findAll)', () => {
    it('should call findAllForRange when start and end params provided', async () => {
      service.findAllForRange!.mockResolvedValue([]);

      await controller.findAll(req as any, '2025-01-01', '2025-01-31');

      expect(service.findAllForRange).toHaveBeenCalledWith(
        'trainer-uuid-1',
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('should call findAll when no range params', async () => {
      service.findAll!.mockResolvedValue([]);

      await controller.findAll(req as any);

      expect(service.findAll).toHaveBeenCalledWith('trainer-uuid-1');
    });
  });

  describe('PATCH /:id/scope', () => {
    it('should extract scope from body and pass data + scope to service', async () => {
      const updateDto = { scope: 'single' as const, notes: 'Updated' };
      service.updateWithScope!.mockResolvedValue({ id: 'sess-1' } as any);

      await controller.updateWithScope(req as any, 'sess-1', updateDto as any);

      expect(service.updateWithScope).toHaveBeenCalledWith(
        'trainer-uuid-1',
        'sess-1',
        { notes: 'Updated' },
        'single',
      );
    });
  });

  describe('POST /:id/toggle-complete', () => {
    it('should delegate to service.toggleComplete', async () => {
      service.toggleComplete!.mockResolvedValue({ id: 'sess-1', completed: true } as any);

      await controller.toggleComplete(req as any, 'sess-1');

      expect(service.toggleComplete).toHaveBeenCalledWith('trainer-uuid-1', 'sess-1');
    });
  });

  describe('DELETE /:id', () => {
    it('should delegate to service.remove', async () => {
      service.remove!.mockResolvedValue({ id: 'sess-1' } as any);

      await controller.remove(req as any, 'sess-1');

      expect(service.remove).toHaveBeenCalledWith('trainer-uuid-1', 'sess-1');
    });
  });

  describe('PATCH /exception', () => {
    it('should delegate to service.upsertSessionException', async () => {
      const dto = { recurringEventId: 'event-1', originalStartTime: '2025-01-13T10:00:00Z', cancelled: true };
      service.upsertSessionException!.mockResolvedValue({ id: 'exc-1' } as any);

      await controller.upsertException(req as any, dto as any);

      expect(service.upsertSessionException).toHaveBeenCalledWith('trainer-uuid-1', dto);
    });
  });

  describe('DELETE /recurring-event/:id', () => {
    it('should delegate to service.removeRecurringEvent', async () => {
      service.removeRecurringEvent!.mockResolvedValue({ id: 'event-1' } as any);

      await controller.removeRecurringEvent(req as any, 'event-1');

      expect(service.removeRecurringEvent).toHaveBeenCalledWith('trainer-uuid-1', 'event-1');
    });
  });
});
