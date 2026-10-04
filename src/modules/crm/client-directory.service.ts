import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { ClientDirectory, ClientSummary } from "../../common/ports";
import { NOT_DELETED } from "../../common/prisma/soft-delete";
import { PrismaService } from "../prisma/prisma.service";

const SUMMARY_SELECT = {
  id: true,
  userId: true,
  name: true,
  email: true,
  phone: true,
  avatar: true,
  status: true,
  dateOfBirth: true,
  notificationEnabled: true,
} satisfies Prisma.ClientSelect;

/**
 * Read-only client lookups for every module (port CLIENT_DIRECTORY).
 * A soft-deleted client does not exist here.
 */
@Injectable()
export class ClientDirectoryService implements ClientDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async requireOwned(userId: string, clientId: string): Promise<ClientSummary> {
    const client = await this.findById(clientId);
    if (!client) {
      throw new NotFoundException(`Client #${clientId} not found`);
    }
    if (client.userId !== userId) {
      throw new ForbiddenException("Acesso negado a este cliente");
    }
    return client;
  }

  findById(clientId: string): Promise<ClientSummary | null> {
    return this.prisma.client.findFirst({
      where: { id: clientId, ...NOT_DELETED },
      select: SUMMARY_SELECT,
    });
  }

  async findManyOwned(
    userId: string,
    clientIds: readonly string[],
  ): Promise<Map<string, ClientSummary>> {
    if (clientIds.length === 0) return new Map();
    const clients = await this.prisma.client.findMany({
      where: { id: { in: [...new Set(clientIds)] }, userId, ...NOT_DELETED },
      select: SUMMARY_SELECT,
    });
    return new Map(clients.map((client) => [client.id, client]));
  }

  async countByOwners(
    userIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const groups = await this.prisma.client.groupBy({
      by: ["userId"],
      where: { userId: { in: [...new Set(userIds)] }, ...NOT_DELETED },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.userId, group._count._all]));
  }
}
