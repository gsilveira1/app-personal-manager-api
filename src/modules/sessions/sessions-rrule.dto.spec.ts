import { validate } from 'class-validator';
import { CreateRecurringEventDto, UpsertSessionExceptionDto } from './sessions-rrule.dto';

describe('CreateRecurringEventDto', () => {
  const createDto = (data: Partial<CreateRecurringEventDto>): CreateRecurringEventDto => {
    const dto = new CreateRecurringEventDto();
    Object.assign(dto, data);
    return dto;
  };

  const validData: Partial<CreateRecurringEventDto> = {
    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12',
    timezone: 'America/Sao_Paulo',
    dtstart: '2025-01-06T10:00:00.000Z',
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
      notes: 'Treino A',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when rrule does not start with FREQ=', async () => {
    const dto = createDto({ ...validData, rrule: 'INVALID_RRULE' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'rrule')).toBe(true);
  });

  it('should fail when rrule is missing', async () => {
    const { rrule, ...noRrule } = validData;
    const dto = createDto(noRrule);
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'rrule')).toBe(true);
  });

  it('should fail when durationMinutes is less than 1', async () => {
    const dto = createDto({ ...validData, durationMinutes: 0 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'durationMinutes')).toBe(true);
  });

  it('should fail when durationMinutes is not an integer', async () => {
    const dto = createDto({ ...validData, durationMinutes: 45.5 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'durationMinutes')).toBe(true);
  });

  it('should fail when clientId is not a UUID', async () => {
    const dto = createDto({ ...validData, clientId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'clientId')).toBe(true);
  });

  it('should fail when dtstart is not a valid date string', async () => {
    const dto = createDto({ ...validData, dtstart: 'not-a-date' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'dtstart')).toBe(true);
  });

  it('should fail when timezone is missing', async () => {
    const { timezone, ...noTz } = validData;
    const dto = createDto(noTz);
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'timezone')).toBe(true);
  });
});

describe('UpsertSessionExceptionDto', () => {
  const createDto = (data: Partial<UpsertSessionExceptionDto>): UpsertSessionExceptionDto => {
    const dto = new UpsertSessionExceptionDto();
    Object.assign(dto, data);
    return dto;
  };

  const validData = {
    recurringEventId: '550e8400-e29b-41d4-a716-446655440000',
    originalStartTime: '2025-01-13T10:00:00.000Z',
  };

  it('should pass with required fields only', async () => {
    const dto = createDto(validData);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with all optional fields', async () => {
    const dto = createDto({
      ...validData,
      cancelled: true,
      newStartTime: '2025-01-14T14:00:00.000Z',
      durationMinutes: 45,
      notes: 'Remarcado',
      completed: false,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when recurringEventId is not a UUID', async () => {
    const dto = createDto({ ...validData, recurringEventId: 'not-uuid' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'recurringEventId')).toBe(true);
  });

  it('should fail when originalStartTime is invalid date', async () => {
    const dto = createDto({ ...validData, originalStartTime: 'not-a-date' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'originalStartTime')).toBe(true);
  });

  it('should fail when durationMinutes is less than 1', async () => {
    const dto = createDto({ ...validData, durationMinutes: 0 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'durationMinutes')).toBe(true);
  });

  it('should fail when newStartTime is invalid date', async () => {
    const dto = createDto({ ...validData, newStartTime: 'bad-date' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'newStartTime')).toBe(true);
  });
});
