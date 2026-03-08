import { validate } from 'class-validator';
import { AuthLoginDTO } from './auth-login.dto';

describe('AuthLoginDTO', () => {
  const createDto = (data: Partial<AuthLoginDTO>): AuthLoginDTO => {
    const dto = new AuthLoginDTO();
    Object.assign(dto, data);
    return dto;
  };

  it('should pass validation with valid email and password (6 chars)', async () => {
    const dto = createDto({ email: 'user@example.com', password: 'abc123' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass validation with password of 16 chars (max)', async () => {
    const dto = createDto({ email: 'user@example.com', password: '1234567890123456' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when email is invalid', async () => {
    const dto = createDto({ email: 'not-an-email', password: 'senha123' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('should fail when email is missing', async () => {
    const dto = createDto({ password: 'senha123' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('should fail when password is too short (< 6 chars)', async () => {
    const dto = createDto({ email: 'user@example.com', password: '12345' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'password')).toBe(true);
  });

  it('should fail when password is too long (> 16 chars)', async () => {
    const dto = createDto({ email: 'user@example.com', password: '12345678901234567' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'password')).toBe(true);
  });

  it('should fail when password is missing', async () => {
    const dto = createDto({ email: 'user@example.com' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'password')).toBe(true);
  });

  it('should fail when both fields are missing', async () => {
    const dto = createDto({});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
