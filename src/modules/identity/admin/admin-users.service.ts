import { Inject, Injectable } from "@nestjs/common";
import { Prisma, User } from "@prisma/client";
import { CLIENT_DIRECTORY, ClientDirectory } from "../../../common/ports";
import { PrismaService } from "../../prisma/prisma.service";
import { isPrismaError, RECORD_NOT_FOUND, userNotFound } from "../errors";
import { definedOnly, UserSettingsStore } from "../user-settings.store";
import {
  AdminUserView,
  toAdminUserView,
  toUserView,
  UserView,
} from "../user-view";
import {
  ADMIN_USERS_DEFAULT_LIMIT,
  AdminUserQueryDto,
  UpdateUserAdminDto,
} from "./admin-users.dto";

export interface PaginatedAdminUsers {
  items: AdminUserView[];
  total: number;
  page: number;
  totalPages: number;
}

/** Account administration (formerly the tenant admin screen). Admin role only. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: UserSettingsStore,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
  ) {}

  /**
   * @returns One page of accounts, newest first, each with its live client count
   *
   * @example
   * await adminUsersService.findAll({ page: 1, limit: 20, status: "BLOCKED" });
   */
  async findAll(query: AdminUserQueryDto): Promise<PaginatedAdminUsers> {
    const page = query.page ?? 1;
    const limit = query.limit ?? ADMIN_USERS_DEFAULT_LIMIT;
    const where: Prisma.UserWhereInput = query.status
      ? { status: query.status }
      : {};

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const counts = await this.clients.countByOwners(users.map((u) => u.id));

    return {
      items: users.map((u) => toAdminUserView(u, counts.get(u.id) ?? 0)),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /** @throws {NotFoundException} When the user does not exist */
  async findOne(id: string): Promise<UserView> {
    return toUserView(await this.requireUser(id));
  }

  /**
   * Changes the account standing and/or its limits. `limits` is merged over the
   * current limits; the other settings are untouched.
   *
   * @throws {NotFoundException} When the user does not exist
   * @throws {BadRequestException} When the resulting limits are invalid
   */
  async update(id: string, dto: UpdateUserAdminDto): Promise<AdminUserView> {
    await this.requireUser(id);
    const limits = dto.limits;
    const user = await this.prisma.$transaction(async (tx) => {
      if (limits) {
        await this.settings.patchWithin(tx, id, (current) => ({
          limits: { ...current.limits, ...definedOnly(limits) },
        }));
      }
      return tx.user.update({
        where: { id },
        data: dto.status ? { status: dto.status } : {},
      });
    });
    const counts = await this.clients.countByOwners([id]);
    return toAdminUserView(user, counts.get(id) ?? 0);
  }

  /**
   * Hard delete: the schema cascades to everything the trainer owns.
   * @throws {NotFoundException} When the user does not exist
   */
  async remove(id: string): Promise<void> {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) throw userNotFound(id);
      throw error;
    }
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw userNotFound(id);
    return user;
  }
}
