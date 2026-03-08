import { validate } from 'class-validator';
import { CreatePlanDto } from './plans-create.dto';

describe('CreatePlanDto', () => {
  const createDto = (data: Partial<CreatePlanDto>): CreatePlanDto => {
    const dto = new CreatePlanDto();
    Object.assign(dto, data);
    return dto;
  };

  const validData = {
    type: 'PRESENCIAL' as const,
    name: 'Plano Básico',
    sessionsPerWeek: 3,
    price: 200,
  };

  it('should pass with valid required fields', async () => {
    const dto = createDto(validData);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with optional durationMinutes (30,45,60,90)', async () => {
    for (const dur of [30, 45, 60, 90]) {
      const dto = createDto({ ...validData, durationMinutes: dur });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('should fail with invalid type', async () => {
    const dto = createDto({ ...validData, type: 'INVALID' as any });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'type')).toBe(true);
  });

  it('should fail when sessionsPerWeek < 1', async () => {
    const dto = createDto({ ...validData, sessionsPerWeek: 0 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'sessionsPerWeek')).toBe(true);
  });

  it('should fail when sessionsPerWeek > 6', async () => {
    const dto = createDto({ ...validData, sessionsPerWeek: 7 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'sessionsPerWeek')).toBe(true);
  });

  it('should fail when durationMinutes is invalid value', async () => {
    const dto = createDto({ ...validData, durationMinutes: 50 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'durationMinutes')).toBe(true);
  });

  it('should fail when price is negative', async () => {
    const dto = createDto({ ...validData, price: -1 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'price')).toBe(true);
  });

  it('should pass with price = 0', async () => {
    const dto = createDto({ ...validData, price: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with CONSULTORIA type', async () => {
    const dto = createDto({ ...validData, type: 'CONSULTORIA' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
