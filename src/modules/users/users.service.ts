import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { GcsService } from "../gcs/gcs.service";
import { User } from "@prisma/client";
import { CreateUserDto } from "./users-create.dto";
import { UpdateUserDto } from "./users-update.dto";
import * as bcrypt from "bcrypt";

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private gcs: GcsService,
  ) {}

  async create(data: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException("Este e-mail já está em uso.");
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const userRole = data.role || "trainer";
    const slug = `trainer-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    // Criação automática do tenant atrelado ao novo treinador
    const tenant = await this.prisma.tenant.create({
      data: {
        name: `${data.name} Studio`,
        slug,
        primaryColor: "#10B981",
        setupCompleted: false,
      },
    });

    // Removemos a senha do retorno para segurança
    const { password, ...result } = await this.prisma.user.create({
      data: {
        ...data,
        role: userRole,
        password: hashedPassword,
        tenantId: tenant.id,
      },
      include: {
        tenant: true,
      },
    });

    return result;
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      include: { tenant: true },
    });
    // Remover senhas da lista
    return users.map(({ password, ...user }: any) => user);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { tenant: true },
    });
    if (!user) throw new NotFoundException(`Usuário #${id} não encontrado`);

    const { password, ...result } = user;
    return result;
  }

  // Método específico para o AuthService (precisa da senha para comparar)
  async findByEmailForAuth(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });
  }

  async update(id: string, data: UpdateUserDto) {
    await this.findOne(id); // Garante existência

    const updateData: any = { ...data };

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    const { password, ...result } = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    return result;
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.user.delete({ where: { id } });
  }

  async generateAvatarUploadUrl(userId: string, contentType: string) {
    await this.findOne(userId); // Garante existência

    const ext = contentType.split("/")[1] || "png";
    const objectPath = `avatars/users/${userId}.${ext}`;

    return this.gcs.generateSignedUploadUrl(objectPath, contentType);
  }
}
