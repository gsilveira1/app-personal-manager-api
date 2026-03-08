import { validate } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

describe('CreateLeadDto', () => {
  const createDto = (data: Partial<CreateLeadDto>): CreateLeadDto => {
    const dto = new CreateLeadDto();
    Object.assign(dto, data);
    return dto;
  };

  const validData = {
    name: 'Carlos Silva',
    email: 'carlos@example.com',
    phone: '53999001122',
    interest: 'presencial' as const,
  };

  it('should pass with valid required fields', async () => {
    const dto = createDto(validData);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with optional message', async () => {
    const dto = createDto({ ...validData, message: 'Quero começar!' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with interest "online"', async () => {
    const dto = createDto({ ...validData, interest: 'online' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with interest "ambos"', async () => {
    const dto = createDto({ ...validData, interest: 'ambos' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail with invalid interest value', async () => {
    const dto = createDto({ ...validData, interest: 'hibrido' as any });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'interest')).toBe(true);
  });

  it('should fail when name is empty', async () => {
    const dto = createDto({ ...validData, name: '' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('should fail when email is invalid', async () => {
    const dto = createDto({ ...validData, email: 'not-email' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('should fail when phone is empty', async () => {
    const dto = createDto({ ...validData, phone: '' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'phone')).toBe(true);
  });

  it('should fail when required fields are missing', async () => {
    const dto = createDto({});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
