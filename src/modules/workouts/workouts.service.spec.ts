import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { WorkoutsService } from './workouts.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WorkoutsService', () => {
  let service: WorkoutsService;
  let prisma: any;

  const userId = 'trainer-uuid-1';
  const workoutId = 'workout-uuid-1';

  const mockWorkout = {
    id: workoutId,
    title: 'Treino A - Peito/Tríceps',
    description: 'Treino de push',
    status: 'Active',
    tags: ['push', 'peito'],
    exercises: [{ name: 'Supino Reto', sets: 4, reps: '8-12' }],
    userId,
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      workoutPlan: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WorkoutsService>(WorkoutsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create workout with exercises as JSON', async () => {
      prisma.workoutPlan.create.mockResolvedValue(mockWorkout);

      const dto = {
        title: 'Treino A - Peito/Tríceps',
        exercises: [{ name: 'Supino Reto', sets: 4, reps: '8-12' }],
      };
      const result = await service.create(userId, dto as any);

      expect(prisma.workoutPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Treino A - Peito/Tríceps',
          userId,
          exercises: expect.any(Array),
        }),
      });
      expect(result.id).toBe(workoutId);
    });

    it('should create template workout (no clientId)', async () => {
      prisma.workoutPlan.create.mockResolvedValue(mockWorkout);

      const dto = { title: 'Template', exercises: [{ name: 'Agachamento', sets: 3, reps: '10' }] };
      await service.create(userId, dto as any);

      expect(prisma.workoutPlan.create).toHaveBeenCalledWith({
        data: expect.not.objectContaining({ clientId: expect.any(String) }),
      });
    });

    it('should create client-specific workout', async () => {
      prisma.workoutPlan.create.mockResolvedValue({ ...mockWorkout, clientId: 'client-1' });

      const dto = {
        title: 'Treino Maria',
        exercises: [{ name: 'Leg Press', sets: 4, reps: '12' }],
        clientId: 'client-1',
      };
      await service.create(userId, dto as any);

      expect(prisma.workoutPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ clientId: 'client-1' }),
      });
    });
  });

  describe('findAll', () => {
    it('should return workouts with client names', async () => {
      prisma.workoutPlan.findMany.mockResolvedValue([mockWorkout]);

      const result = await service.findAll(userId);

      expect(prisma.workoutPlan.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: { client: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return workout when owned', async () => {
      prisma.workoutPlan.findUnique.mockResolvedValue({ ...mockWorkout, client: null });

      const result = await service.findOne(userId, workoutId);
      expect(result.id).toBe(workoutId);
    });

    it('should throw NotFoundException', async () => {
      prisma.workoutPlan.findUnique.mockResolvedValue(null);
      await expect(service.findOne(userId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong owner', async () => {
      prisma.workoutPlan.findUnique.mockResolvedValue({ ...mockWorkout, userId: 'other', client: null });
      await expect(service.findOne(userId, workoutId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update workout including exercises JSON', async () => {
      prisma.workoutPlan.findUnique.mockResolvedValue({ ...mockWorkout, client: null });
      prisma.workoutPlan.update.mockResolvedValue({ ...mockWorkout, title: 'Updated' });

      const result = await service.update(userId, workoutId, {
        title: 'Updated',
        exercises: [{ name: 'Puxada', sets: 3, reps: '10' }],
      } as any);

      expect(prisma.workoutPlan.update).toHaveBeenCalledWith({
        where: { id: workoutId },
        data: expect.objectContaining({ title: 'Updated', exercises: expect.any(Array) }),
      });
    });

    it('should update without exercises (partial update)', async () => {
      prisma.workoutPlan.findUnique.mockResolvedValue({ ...mockWorkout, client: null });
      prisma.workoutPlan.update.mockResolvedValue({ ...mockWorkout, title: 'New Title' });

      await service.update(userId, workoutId, { title: 'New Title' } as any);

      const callData = prisma.workoutPlan.update.mock.calls[0][0].data;
      expect(callData).not.toHaveProperty('exercises');
    });
  });

  describe('remove', () => {
    it('should delete workout after ownership check', async () => {
      prisma.workoutPlan.findUnique.mockResolvedValue({ ...mockWorkout, client: null });
      prisma.workoutPlan.delete.mockResolvedValue(mockWorkout);

      await service.remove(userId, workoutId);
      expect(prisma.workoutPlan.delete).toHaveBeenCalledWith({ where: { id: workoutId } });
    });
  });
});
