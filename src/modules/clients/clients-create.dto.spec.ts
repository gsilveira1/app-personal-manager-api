import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateClientDto } from './clients-create.dto';

describe('CreateClientDto', () => {
  const createDto = (data: Record<string, any>): CreateClientDto => {
    return plainToInstance(CreateClientDto, data);
  };

  const validData = {
    name: 'Maria Santos',
    email: 'maria@example.com',
    phone: '53999001122',
    type: 'In-Person',
  };

  it('should pass with valid required fields', async () => {
    const dto = createDto(validData);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with all optional fields', async () => {
    const dto = createDto({
      ...validData,
      status: 'Active',
      goal: 'Hipertrofia',
      avatar: 'https://example.com/avatar.jpg',
      notes: 'Aluna dedicada',
      dateOfBirth: '1995-03-15',
      checkInFreq: 'Weekly',
      planId: '550e8400-e29b-41d4-a716-446655440000',
      medicalHistory: {
        objective: ['Saúde', 'Estética'],
        hasHeartDisease: false,
        smoker: false,
        drinker: false,
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when name is missing', async () => {
    const dto = createDto({ email: 'maria@example.com', phone: '123', type: 'In-Person' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('should fail when email is invalid', async () => {
    const dto = createDto({ ...validData, email: 'not-email' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('should fail when phone is missing', async () => {
    const dto = createDto({ name: 'Maria', email: 'maria@example.com', type: 'In-Person' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'phone')).toBe(true);
  });

  it('should fail when type is missing', async () => {
    const dto = createDto({ name: 'Maria', email: 'maria@example.com', phone: '123' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'type')).toBe(true);
  });

  it('should fail when planId is not a valid UUID', async () => {
    const dto = createDto({ ...validData, planId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'planId')).toBe(true);
  });

  it('should fail when status is invalid enum value', async () => {
    const dto = createDto({ ...validData, status: 'InvalidStatus' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'status')).toBe(true);
  });

  it('should pass with valid status enum (Lead)', async () => {
    const dto = createDto({ ...validData, status: 'Lead' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
