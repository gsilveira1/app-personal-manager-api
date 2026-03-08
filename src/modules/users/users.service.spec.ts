import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcrypt');

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  const mockUser = {
    id: 'user-uuid-1',
    name: 'João Silva',
    email: 'joao@example.com',
    password: '$2b$10$hashedpassword',
    role: 'user',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should hash password and return user without password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.user.create.mockResolvedValue({ ...mockUser, password: 'hashed-pw' });

      const result = await service.create({ name: 'João Silva', email: 'joao@example.com', password: 'senha123' });

      expect(bcrypt.hash).toHaveBeenCalledWith('senha123', 10);
      expect(result).not.toHaveProperty('password');
      expect(result.name).toBe('João Silva');
    });

    it('should throw ConflictException when email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.create({ name: 'Test', email: 'joao@example.com', password: 'senha123' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return users with password stripped', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('password');
      expect(result[0].name).toBe('João Silva');
    });

    it('should return empty array when no users', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return user without password', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findOne('user-uuid-1');

      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('user-uuid-1');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmailForAuth', () => {
    it('should return user WITH password for auth comparison', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByEmailForAuth('joao@example.com');

      expect(result).toHaveProperty('password');
      expect(result!.password).toBe('$2b$10$hashedpassword');
    });

    it('should return null for non-existent email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmailForAuth('unknown@example.com');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should rehash password if provided', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-pw');
      prisma.user.update.mockResolvedValue({ ...mockUser, password: 'new-hashed-pw', name: 'Novo Nome' });

      const result = await service.update('user-uuid-1', { name: 'Novo Nome', password: 'newsecret' });

      expect(bcrypt.hash).toHaveBeenCalledWith('newsecret', 10);
      expect(result).not.toHaveProperty('password');
    });

    it('should not rehash when password is not provided', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({ ...mockUser, name: 'Novo Nome' });

      await service.update('user-uuid-1', { name: 'Novo Nome' });

      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.update('non-existent', { name: 'Test' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.delete.mockResolvedValue(mockUser);

      const result = await service.remove('user-uuid-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-uuid-1' } });
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});
