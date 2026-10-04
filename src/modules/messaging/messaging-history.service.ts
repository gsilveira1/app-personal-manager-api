import { Injectable } from "@nestjs/common";
import { NotificationLog, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LogsQueryDto } from "./dto/logs-query.dto";
import { PendingNotificationsService } from "./pending-notifications.service";

const DEFAULT_PAGE_SIZE = 20;

export interface LogsSummary {
  totalSent: number;
  totalFailed: number;
  totalCancelled: number;
  totalPending: number;
}

export interface LogsPage {
  items: NotificationLog[];
  total: number;
  page: number;
  totalPages: number;
  summary: LogsSummary;
}

function buildWhere(
  userId: string,
  query: LogsQueryDto,
): Prisma.NotificationLogWhereInput {
  const where: Prisma.NotificationLogWhereInput = { userId };
  if (query.status && query.status !== "ALL") {
    where.status = query.status;
  }
  if (query.channel && query.channel !== "ALL") {
    where.channel = query.channel;
  }
  if (query.search) {
    const contains = { contains: query.search, mode: "insensitive" as const };
    where.OR = [
      { recipientPhone: contains },
      { templateType: contains },
      { error: contains },
    ];
  }
  return where;
}

/** Read side of the audit trail (NotificationLog). */
@Injectable()
export class MessagingHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pending: PendingNotificationsService,
  ) {}

  /**
   * One page of the caller's audit rows, newest first, with totals per status.
   * `summary` counts all of the caller's rows, regardless of the filters.
   *
   * @throws {ServiceUnavailableException} When Redis cannot be reached (`totalPending` comes from the queue)
   */
  async getLogs(userId: string, query: LogsQueryDto): Promise<LogsPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const where = buildWhere(userId, query);

    const [total, items, byStatus, pending] = await Promise.all([
      this.prisma.notificationLog.count({ where }),
      this.prisma.notificationLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.notificationLog.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
      this.pending.list(userId),
    ]);

    const countOf = (status: string) =>
      byStatus.find((group) => group.status === status)?._count._all ?? 0;
    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        totalSent: countOf("SENT"),
        totalFailed: countOf("FAILED"),
        totalCancelled: countOf("CANCELLED"),
        totalPending: pending.length,
      },
    };
  }

  /**
   * Audit rows of one client, newest first. The `userId` filter is the access
   * control: an unknown or foreign client id yields `[]`.
   */
  getClientMessages(
    userId: string,
    clientId: string,
  ): Promise<NotificationLog[]> {
    return this.prisma.notificationLog.findMany({
      where: { userId, clientId },
      orderBy: { createdAt: "desc" },
    });
  }
}
