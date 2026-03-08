import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;

  const mockUser = {
    id: 'user-uuid-1',
    name: 'João Silva',
    email: 'joao@example.com',
    password: '$2b$10$hashedpassword',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    usersService = {
      findByEmailForAuth: jest.fn(),
    };
    jwtService = {
      sign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('joao@example.com', 'senha123');

      expect(usersService.findByEmailForAuth).toHaveBeenCalledWith('joao@example.com');
      expect(bcrypt.compare).toHaveBeenCalledWith('senha123', '$2b$10$hashedpassword');
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('user-uuid-1');
      expect(result.name).toBe('João Silva');
      expect(result.email).toBe('joao@example.com');
    });

    it('should return null when email does not exist', async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(null);

      const result = await service.validateUser('unknown@example.com', 'senha123');

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should return null when password is wrong', async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('joao@example.com', 'wrongpassword');

      expect(result).toBeNull();
    });

    it('should return null when bcrypt comparison throws', async () => {
      usersService.findByEmailForAuth!.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockRejectedValue(new Error('bcrypt error'));

      await expect(service.validateUser('joao@example.com', 'senha123')).rejects.toThrow('bcrypt error');
    });
  });

  describe('login', () => {
    it('should return access_token and user object', async () => {
      const user = { id: 'user-uuid-1', name: 'João Silva', email: 'joao@example.com', role: 'user' };
      jwtService.sign!.mockReturnValue('jwt-token-123');

      const result = await service.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({
        username: 'João Silva',
        sub: 'user-uuid-1',
        role: 'user',
      });
      expect(result).toEqual({
        access_token: 'jwt-token-123',
        user: {
          id: 'user-uuid-1',
          name: 'João Silva',
          email: 'joao@example.com',
          role: 'user',
        },
      });
    });

    it('should include correct payload in JWT token', async () => {
      const user = { id: 'admin-uuid', name: 'Admin User', email: 'admin@example.com', role: 'admin' };
      jwtService.sign!.mockReturnValue('admin-token');

      await service.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({
        username: 'Admin User',
        sub: 'admin-uuid',
        role: 'admin',
      });
    });
  });
});
