import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AdminTenantQueryDto,
  CreateTenantAdminDto,
  UpdateTenantAdminDto,
} from "./dto/admin.dto";

@Injectable()
export class AdminTenantsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: AdminTenantQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.TenantWhereInput = {};
    if (query.status) {
      where.status = query.status as any;
    }

    const [total, tenants] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        include: {
          users: {
            include: {
              _count: {
                select: { clients: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const items = tenants.map((t) => {
      const studentsCount = t.users.reduce(
        (sum, u) => sum + (u._count?.clients || 0),
        0,
      );

      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        studentsCount,
        features: t.features || {
          maxStudents: 50,
          canUploadVideos: true,
          whatsappAlerts: true,
        },
        createdAt: t.createdAt,
      };
    });

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(dto: CreateTenantAdminDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(`Tenant com slug "${dto.slug}" já existe.`);
    }

    const features = {
      maxStudents: dto.maxStudents ?? 50,
      canUploadVideos: dto.canUploadVideos ?? true,
      whatsappAlerts: dto.whatsappAlerts ?? true,
    };

    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        status: "ACTIVE",
        features: features as any,
      },
    });
  }

  async update(id: string, dto: UpdateTenantAdminDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant #${id} não encontrado.`);
    }

    const updateData: Prisma.TenantUpdateInput = {};
    if (dto.status) {
      updateData.status = dto.status;
    }
    if (dto.features) {
      updateData.features = dto.features as any;
    }

    return this.prisma.tenant.update({
      where: { id },
      data: updateData,
    });
  }
}
