import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSessionDto, CreateRecurringSessionDto, UpdateSessionScopeDto } from './sessions.dto';

describe('CreateSessionDto', () => {
  const createDto = (data: Record<string, any>): CreateSessionDto => {
    return plainToInstance(CreateSessionDto, data);
  };

  const validData = {
    date: '2025-02-01T10:00:00.000Z',
    durationMinutes: 60,
    type: 'In-Person',
    category: 'Workout',
    clientId: '550e8400-e29b-41d4-a716-446655440000',
  };

  it('should pass with valid required fields', async () => {
    const dto = createDto(validData);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with optional fields', async () => {
    const dto = createDto({
      ...validData,
      linkedWorkoutId: '550e8400-e29b-41d4-a716-446655440001',
      notes: 'Treino pesado',
      completed: false,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when date is missing', async () => {
    const { date, ...noDate } = validData;
    const dto = createDto(noDate);
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'date')).toBe(true);
  });

  it('should fail when durationMinutes is not an integer', async () => {
    const dto = createDto({ ...validData, durationMinutes: 60.5 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'durationMinutes')).toBe(true);
  });

  it('should fail when clientId is not a UUID', async () => {
    const dto = createDto({ ...validData, clientId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'clientId')).toBe(true);
  });

  it('should fail when type is missing', async () => {
    const { type, ...noType } = validData;
    const dto = createDto(noType);
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'type')).toBe(true);
  });

  it('should fail when category is missing', async () => {
    const { category, ...noCat } = validData;
    const dto = createDto(noCat);
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'category')).toBe(true);
  });
});

describe('CreateRecurringSessionDto', () => {
  const createDto = (data: Record<string, any>): CreateRecurringSessionDto => {
    return plainToInstance(CreateRecurringSessionDto, data);
  };

  it('should pass with valid data', async () => {
    const dto = createDto({
      baseSession: {
        date: '2025-02-01T10:00:00.000Z',
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
      },
      startDateStr: '2025-02-01',
      frequency: 'weekly',
      untilDateStr: '2025-03-01',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail with invalid frequency', async () => {
    const dto = createDto({
      baseSession: {
        date: '2025-02-01T10:00:00.000Z',
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        clientId: '550e8400-e29b-41d4-a716-446655440000',
      },
      startDateStr: '2025-02-01',
      frequency: 'monthly',
      untilDateStr: '2025-03-01',
    });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'frequency')).toBe(true);
  });
});

describe('UpdateSessionScopeDto', () => {
  it('should pass with scope single', async () => {
    const dto = plainToInstance(UpdateSessionScopeDto, { scope: 'single' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with scope future', async () => {
    const dto = plainToInstance(UpdateSessionScopeDto, { scope: 'future' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail with invalid scope', async () => {
    const dto = plainToInstance(UpdateSessionScopeDto, { scope: 'all' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'scope')).toBe(true);
  });
});
