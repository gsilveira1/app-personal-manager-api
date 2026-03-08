import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let usersService: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      validateUser: jest.fn(),
      login: jest.fn(),
    };
    usersService = {
      create: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /login', () => {
    it('should return access_token on valid credentials', async () => {
      const user = { id: '1', name: 'João', email: 'joao@test.com', role: 'user' };
      authService.validateUser!.mockResolvedValue(user);
      authService.login!.mockResolvedValue({ access_token: 'jwt-token', user });

      const result = await controller.login({ email: 'joao@test.com', password: 'senha123' } as any);

      expect(authService.validateUser).toHaveBeenCalledWith('joao@test.com', 'senha123');
      expect(authService.login).toHaveBeenCalledWith(user);
      expect(result.access_token).toBe('jwt-token');
    });

    it('should throw UnauthorizedException on invalid credentials', async () => {
      authService.validateUser!.mockResolvedValue(null);

      await expect(
        controller.login({ email: 'bad@test.com', password: 'wrong' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('POST /logout', () => {
    it('should return success message', () => {
      const result = controller.logout();
      expect(result.message).toContain('sucesso');
    });
  });

  describe('POST /signup', () => {
    it('should delegate to usersService.create', async () => {
      const newUser = { id: '2', name: 'Maria', email: 'maria@test.com' };
      usersService.create!.mockResolvedValue(newUser as any);

      const result = await controller.signup({ name: 'Maria', email: 'maria@test.com', password: 'senha123' } as any);

      expect(usersService.create).toHaveBeenCalledWith({ name: 'Maria', email: 'maria@test.com', password: 'senha123' });
      expect(result).toEqual(newUser);
    });
  });

  describe('GET /me', () => {
    it('should return user profile from JWT userId', async () => {
      const user = { id: '1', name: 'João', email: 'joao@test.com' };
      usersService.findOne!.mockResolvedValue(user as any);

      const req = { user: { userId: '1', email: 'joao@test.com' } };
      const result = await controller.getProfile(req as any);

      expect(usersService.findOne).toHaveBeenCalledWith('1');
      expect(result).toEqual(user);
    });
  });
});
