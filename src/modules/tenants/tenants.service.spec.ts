import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappStatus } from '@prisma/client';

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    tenant: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOrCreateTenantForUser', () => {
    it('should return existing tenant if user has one', async () => {
      const mockTenant = {
        id: 'tenant-1',
        name: 'Vivi Studio',
        slug: 'vivi-studio',
        primaryColor: '#10B981',
        setupCompleted: false,
        whatsappStatus: WhatsappStatus.PENDING,
      };

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Vivi',
        tenant: mockTenant,
      });

      const result = await service.getOrCreateTenantForUser('user-1');
      expect(result).toEqual(mockTenant);
      expect(mockPrismaService.tenant.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getOrCreateTenantForUser('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should auto-create tenant if user does not have one attached', async () => {
      const mockCreatedTenant = {
        id: 'new-tenant-id',
        name: 'Carlos Studio',
        slug: 'trainer-carlos12',
        primaryColor: '#10B981',
        setupCompleted: false,
        whatsappStatus: WhatsappStatus.PENDING,
      };

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'carlos12345',
        name: 'Carlos',
        tenant: null,
      });

      mockPrismaService.tenant.create.mockResolvedValue(mockCreatedTenant);
      mockPrismaService.user.update.mockResolvedValue({});

      const result = await service.getOrCreateTenantForUser('carlos12345');
      expect(result).toEqual(mockCreatedTenant);
      expect(mockPrismaService.tenant.create).toHaveBeenCalled();
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'carlos12345' },
        data: { tenantId: 'new-tenant-id' },
      });
    });
  });

  describe('updateBranding', () => {
    it('should update tenant branding fields', async () => {
      const mockTenant = { id: 'tenant-1', name: 'Studio' };
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        tenant: mockTenant,
      });

      const updatedTenant = {
        ...mockTenant,
        logoUrl: 'https://pub-r2.viviops.com/logos/logo.png',
        primaryColor: '#3B82F6',
      };

      mockPrismaService.tenant.update.mockResolvedValue(updatedTenant);

      const result = await service.updateBranding('user-1', {
        logoUrl: 'https://pub-r2.viviops.com/logos/logo.png',
        primaryColor: '#3B82F6',
      });

      expect(result).toEqual(updatedTenant);
      expect(mockPrismaService.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: {
          logoUrl: 'https://pub-r2.viviops.com/logos/logo.png',
          primaryColor: '#3B82F6',
        },
      });
    });
  });

  describe('connectWhatsapp', () => {
    it('should generate QR code and return connection status', async () => {
      const mockTenant = { id: 'tenant-1', whatsappInstanceName: 'tenant-tenant-1' };
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        tenant: mockTenant,
      });

      mockPrismaService.tenant.update.mockResolvedValue({
        ...mockTenant,
        whatsappStatus: WhatsappStatus.PENDING,
      });

      const result = await service.connectWhatsapp('user-1');
      expect(result.instanceName).toBe('tenant-tenant-1');
      expect(result.qrcodeBase64).toContain('data:image/png;base64');
      expect(result.status).toBe(WhatsappStatus.PENDING);
    });
  });

  describe('completeSetup', () => {
    it('should set setupCompleted to true', async () => {
      const mockTenant = { id: 'tenant-1', setupCompleted: false };
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        tenant: mockTenant,
      });

      mockPrismaService.tenant.update.mockResolvedValue({
        ...mockTenant,
        setupCompleted: true,
      });

      const result = await service.completeSetup('user-1');
      expect(result.success).toBe(true);
      expect(result.tenant.setupCompleted).toBe(true);
      expect(mockPrismaService.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { setupCompleted: true },
      });
    });
  });
});
