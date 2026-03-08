import { validate } from 'class-validator';
import { CreateUserDto } from './users-create.dto';

describe('CreateUserDto', () => {
  const createDto = (data: Partial<CreateUserDto>): CreateUserDto => {
    const dto = new CreateUserDto();
    Object.assign(dto, data);
    return dto;
  };

  it('should pass with valid required fields', async () => {
    const dto = createDto({ name: 'João', email: 'joao@test.com', password: 'senha123' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with optional role', async () => {
    const dto = createDto({ name: 'João', email: 'joao@test.com', password: 'senha123', role: 'admin' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when name is missing', async () => {
    const dto = createDto({ email: 'joao@test.com', password: 'senha123' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'name')).toBe(true);
  });

  it('should fail when email is invalid', async () => {
    const dto = createDto({ name: 'João', email: 'not-email', password: 'senha123' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('should fail when email is missing', async () => {
    const dto = createDto({ name: 'João', password: 'senha123' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('should fail when password is too short (< 6 chars)', async () => {
    const dto = createDto({ name: 'João', email: 'joao@test.com', password: '12345' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'password')).toBe(true);
  });

  it('should fail when password is missing', async () => {
    const dto = createDto({ name: 'João', email: 'joao@test.com' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'password')).toBe(true);
  });

  it('should pass with exactly 6 character password', async () => {
    const dto = createDto({ name: 'João', email: 'joao@test.com', password: '123456' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
