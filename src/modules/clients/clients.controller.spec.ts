import { Test, TestingModule } from '@nestjs/testing';

import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

describe('ClientsController', () => {
  let controller: ClientsController;
  let service: Record<string, jest.Mock>;

  const req = { user: { userId: 'trainer-uuid-1', email: 'trainer@test.com' } };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      findLeads: jest.fn(),
      convertLead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        { provide: ClientsService, useValue: service },
      ],
    }).compile();

    controller = module.get<ClientsController>(ClientsController);
  });

  it('POST / should delegate to create with userId from JWT', async () => {
    const dto = { name: 'Maria', email: 'maria@test.com', phone: '123', type: 'In-Person' };
    service.create!.mockResolvedValue({ id: '1', ...dto } as any);

    await controller.create(req as any, dto as any);

    expect(service.create).toHaveBeenCalledWith('trainer-uuid-1', dto);
  });

  it('GET / should delegate to findAll with userId', async () => {
    service.findAll!.mockResolvedValue([]);

    await controller.findAll(req as any);

    expect(service.findAll).toHaveBeenCalledWith('trainer-uuid-1');
  });

  it('GET /leads should delegate to findLeads with userId', async () => {
    service.findLeads!.mockResolvedValue([]);

    await controller.findLeads(req as any);

    expect(service.findLeads).toHaveBeenCalledWith('trainer-uuid-1');
  });

  it('GET /:id should delegate to findOne with userId and id', async () => {
    service.findOne!.mockResolvedValue({ id: 'client-1' } as any);

    await controller.findOne(req as any, 'client-1');

    expect(service.findOne).toHaveBeenCalledWith('trainer-uuid-1', 'client-1');
  });

  it('PATCH /:id should delegate to update with userId, id, and body', async () => {
    service.update!.mockResolvedValue({ id: 'client-1', name: 'Updated' } as any);

    await controller.update(req as any, 'client-1', { name: 'Updated' } as any);

    expect(service.update).toHaveBeenCalledWith('trainer-uuid-1', 'client-1', { name: 'Updated' });
  });

  it('PATCH /:id/convert should delegate to convertLead with planId from body', async () => {
    service.convertLead!.mockResolvedValue({ id: 'client-1', status: 'Active' } as any);

    await controller.convertLead(req as any, 'client-1', { planId: 'plan-uuid' });

    expect(service.convertLead).toHaveBeenCalledWith('trainer-uuid-1', 'client-1', 'plan-uuid');
  });

  it('PATCH /:id/convert without planId should pass undefined', async () => {
    service.convertLead!.mockResolvedValue({ id: 'client-1', status: 'Active' } as any);

    await controller.convertLead(req as any, 'client-1', {});

    expect(service.convertLead).toHaveBeenCalledWith('trainer-uuid-1', 'client-1', undefined);
  });

  it('DELETE /:id should delegate to remove with userId and id', async () => {
    service.remove!.mockResolvedValue({ id: 'client-1' } as any);

    await controller.remove(req as any, 'client-1');

    expect(service.remove).toHaveBeenCalledWith('trainer-uuid-1', 'client-1');
  });
});
