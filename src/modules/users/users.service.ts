import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { CreateUserDto } from './users-create.dto';
import { UpdateUserDto } from './users-update.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async create(data: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Removemos a senha do retorno para segurança
    const { password, ...result } = await this.prisma.user.create({
      data: {
        ...data,
        password: hashedPassword,
      },
    });

    return result;
  }

  async findAll() {
    const users = await this.prisma.user.findMany();
    // Remover senhas da lista
    return users.map(({ password, ...user }: User) => user);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`Usuário #${id} não encontrado`);

    const { password, ...result } = user;
    return result;
  }

  // Método específico para o AuthService (precisa da senha para comparar)
  async findByEmailForAuth(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
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
}