import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSystemFeatureDto } from './system-features-create.dto';
import { UpdateSystemFeatureDto } from './system-features-update.dto';

@Injectable()
export class SystemFeaturesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSystemFeatureDto) {
    const existing = await this.prisma.systemFeature.findUnique({
      where: { key: data.key },
    });
    if (existing) {
      throw new ConflictException(`Feature with key "${data.key}" already exists`);
    }

    return this.prisma.systemFeature.create({ data });
  }

  async findAll() {
    return this.prisma.systemFeature.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { plans: true } },
      },
    });
  }

  async findOne(id: string) {
    const feature = await this.prisma.systemFeature.findUnique({
      where: { id },
      include: {
        _count: { select: { plans: true } },
      },
    });
    if (!feature) throw new NotFoundException(`SystemFeature #${id} not found`);
    return feature;
  }

  async findAllActive() {
    return this.prisma.systemFeature.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, data: UpdateSystemFeatureDto) {
    await this.findOne(id);
    return this.prisma.systemFeature.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.systemFeature.delete({ where: { id } });
  }
}
