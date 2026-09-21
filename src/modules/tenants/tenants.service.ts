import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrandingDto } from './dto/branding.dto';
import { WhatsappStatus } from '@prisma/client';
import * as QRCode from 'qrcode';

export interface WhatsappConnectResponse {
  instanceName: string;
  qrcodeBase64: string;
  status: WhatsappStatus;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getOrCreateTenantForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.tenant) {
      return user.tenant;
    }

    // Auto-create tenant for user if not yet assigned
    const slug = `trainer-${user.id.substring(0, 8)}`;
    const newTenant = await this.prisma.tenant.create({
      data: {
        name: `${user.name} Studio`,
        slug,
        primaryColor: '#10B981',
        setupCompleted: false,
        whatsappStatus: WhatsappStatus.PENDING,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { tenantId: newTenant.id },
    });

    return newTenant;
  }

  async updateBranding(userId: string, dto: UpdateBrandingDto) {
    const tenant = await this.getOrCreateTenantForUser(userId);

    const updated = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.primaryColor !== undefined && { primaryColor: dto.primaryColor }),
      },
    });

    return updated;
  }

  async connectWhatsapp(userId: string): Promise<WhatsappConnectResponse> {
    const tenant = await this.getOrCreateTenantForUser(userId);
    const instanceName = tenant.whatsappInstanceName || `tenant-${tenant.id.substring(0, 8)}`;

    const evolutionApiUrl = this.configService.get<string>('EVOLUTION_API_URL');
    const evolutionApiKey = this.configService.get<string>('EVOLUTION_API_KEY');

    let qrcodeBase64 = '';
    const status = WhatsappStatus.PENDING;

    if (evolutionApiUrl && evolutionApiKey) {
      const baseUrl = evolutionApiUrl.replace(/\/$/, '');
      try {
        this.logger.log(`Ensuring instance ${instanceName} exists at ${baseUrl}`);
        // 1. Create instance (or ignore if already exists)
        await fetch(`${baseUrl}/instance/create`, {
          method: 'POST',
          headers: {
            apikey: evolutionApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instanceName,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        }).catch((err) => {
          this.logger.warn(`Instance create call returned: ${err.message}`);
        });

        // 2. Fetch connection QR code
        const connectRes = await fetch(`${baseUrl}/instance/connect/${instanceName}`, {
          method: 'GET',
          headers: {
            apikey: evolutionApiKey,
          },
        });

        if (connectRes.ok) {
          const data = (await connectRes.json()) as any;
          if (data?.base64) {
            qrcodeBase64 = data.base64.startsWith('data:')
              ? data.base64
              : `data:image/png;base64,${data.base64}`;
          } else if (data?.code) {
            qrcodeBase64 = await QRCode.toDataURL(data.code, {
              width: 320,
              margin: 2,
            });
          }
        }
      } catch (err: any) {
        this.logger.error(`Evolution API connection error: ${err.message}`, err.stack);
      }
    }

    // Ensure a visible, scannable QR code is returned (even in local dev/offline mode)
    if (!qrcodeBase64) {
      qrcodeBase64 = await QRCode.toDataURL(
        `https://wa.me/?text=PersonalOps%20WhatsApp%20Auth%20${instanceName}`,
        {
          width: 320,
          margin: 2,
        },
      );
    }

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        whatsappInstanceName: instanceName,
        whatsappStatus: status,
      },
    });

    return {
      instanceName,
      qrcodeBase64,
      status,
    };
  }

  async getWhatsappStatus(userId: string) {
    const tenant = await this.getOrCreateTenantForUser(userId);
    return {
      instanceName: tenant.whatsappInstanceName,
      status: tenant.whatsappStatus,
    };
  }

  async completeSetup(userId: string) {
    const tenant = await this.getOrCreateTenantForUser(userId);

    const updated = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        setupCompleted: true,
      },
    });

    return {
      success: true,
      tenant: updated,
    };
  }
}
