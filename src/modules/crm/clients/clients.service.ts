import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ClientStatus, SubscriptionStatus } from "@prisma/client";

import {
  ANAMNESIS_REQUESTER,
  AnamnesisRequester,
  CLIENT_DIRECTORY,
  ClientDirectory,
  WORKOUT_SHEET_READER,
  WorkoutSheetReader,
} from "../../../common/ports";
import { NOT_DELETED } from "../../../common/prisma/soft-delete";
import { GcsService } from "../../gcs/gcs.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PlansService } from "../plans/plans.service";
import { buildClientOrderBy, buildClientWhere } from "./client-list-query";
import { normalizeEmail } from "./client-parsing";
import { ClientStoreService } from "./client-store.service";
import { buildCreateValues, buildUpdateData } from "./client-write-data";
import {
  CLIENT_DETAIL_INCLUDE,
  CLIENT_VIEW_INCLUDE,
  ClientDetail,
  ClientListItem,
  ClientRow,
  ClientView,
  toClientDetail,
  toClientListItem,
  toClientView,
  WelcomeMessageOutcome,
} from "./client.views";
import { buildClientsCsv } from "./clients-csv";
import { ClientQueryDto, DEFAULT_PAGE_SIZE } from "./dto/client-query.dto";
import { CreateClientDto } from "./dto/create-client.dto";
import { UpdateClientDto } from "./dto/update-client.dto";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

const EMAIL_CONFLICT = "Email already exists";

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ClientStoreService,
    private readonly plans: PlansService,
    private readonly gcs: GcsService,
    @Inject(CLIENT_DIRECTORY) private readonly directory: ClientDirectory,
    @Inject(WORKOUT_SHEET_READER) private readonly sheets: WorkoutSheetReader,
    @Inject(ANAMNESIS_REQUESTER) private readonly anamnesis: AnamnesisRequester,
  ) {}

  /**
   * Creates a client, or resurrects the trainer's soft-deleted client with the same
   * e-mail, then asks health to send the welcome anamnesis.
   *
   * @throws {BadRequestException} When `planId` is not one of the trainer's plans
   * @throws {ConflictException} When the e-mail belongs to a live client
   */
  async create(
    userId: string,
    dto: CreateClientDto,
  ): Promise<ClientView & { welcomeMessage: WelcomeMessageOutcome }> {
    if (dto.planId) await this.plans.requireAssignable(userId, dto.planId);
    const row = await this.store.resurrectOrCreate(
      userId,
      normalizeEmail(dto.email),
      buildCreateValues(dto),
      EMAIL_CONFLICT,
    );
    const welcomeMessage = await this.sendWelcome(userId, row);
    return { ...toClientView(row), welcomeMessage };
  }

  /**
   * The client already exists when this runs, so a failure here must not fail the
   * request: it is logged and reported as `FAILED` in the response.
   */
  private async sendWelcome(
    userId: string,
    client: ClientRow,
  ): Promise<WelcomeMessageOutcome> {
    if (!client.notificationEnabled || !client.phone.trim()) return "SKIPPED";
    try {
      await this.anamnesis.requestAnamnesis(userId, client.id, {
        notify: true,
      });
      return "QUEUED";
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : "n/a";
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Welcome message failed for client ${client.id} (HTTP ${status}): ${cause.message}`,
        cause.stack,
      );
      return "FAILED";
    }
  }

  async findPage(
    userId: string,
    query: ClientQueryDto,
  ): Promise<Paginated<ClientListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const where = buildClientWhere(userId, query);
    const [total, rows] = await Promise.all([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: CLIENT_VIEW_INCLUDE,
        orderBy: buildClientOrderBy(query),
      }),
    ]);
    const sheets = await this.sheets.findActiveSummaries(
      userId,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => toClientListItem(row, sheets.get(row.id))),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findLeads(userId: string): Promise<ClientView[]> {
    const rows = await this.prisma.client.findMany({
      where: { userId, status: ClientStatus.LEAD, ...NOT_DELETED },
      include: CLIENT_VIEW_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toClientView);
  }

  async exportCsv(userId: string): Promise<string> {
    const clients = await this.prisma.client.findMany({
      where: { userId, ...NOT_DELETED },
      orderBy: { name: "asc" },
    });
    return buildClientsCsv(clients);
  }

  /**
   * @throws {NotFoundException} When the client does not exist or is soft-deleted
   * @throws {ForbiddenException} When it belongs to another trainer
   */
  async findOne(userId: string, id: string): Promise<ClientDetail> {
    const row = await this.prisma.client.findFirst({
      where: { id, ...NOT_DELETED },
      include: CLIENT_DETAIL_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Client #${id} not found`);
    if (row.userId !== userId) {
      throw new ForbiddenException("Acesso negado a este cliente");
    }
    return toClientDetail(row);
  }

  /**
   * @throws {BadRequestException} When `planId` is not one of the trainer's plans
   * @throws {ConflictException} When the new e-mail is held by another row of the
   *   trainer, live or soft-deleted
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateClientDto,
  ): Promise<ClientView> {
    const current = await this.directory.requireOwned(userId, id);
    const data = buildUpdateData(dto);
    if (typeof data.planId === "string") {
      await this.plans.requireAssignable(userId, data.planId);
    }
    if (typeof data.email === "string" && data.email !== current.email) {
      await this.assertEmailFree(userId, id, data.email);
    }
    return toClientView(await this.store.updateLive(userId, id, data));
  }

  /** Looks at soft-deleted rows too: the unique key covers them. */
  private async assertEmailFree(
    userId: string,
    id: string,
    email: string,
  ): Promise<void> {
    const holder = await this.prisma.client.findFirst({
      where: { userId, email, id: { not: id } },
      select: { id: true },
    });
    if (holder) throw new ConflictException(EMAIL_CONFLICT);
  }

  async updateStatus(
    userId: string,
    id: string,
    status: ClientStatus,
  ): Promise<ClientView> {
    await this.directory.requireOwned(userId, id);
    return toClientView(await this.store.updateLive(userId, id, { status }));
  }

  /** @throws {BadRequestException} When `planId` is not one of the trainer's plans */
  async convertLead(
    userId: string,
    id: string,
    planId?: string,
  ): Promise<ClientView> {
    await this.directory.requireOwned(userId, id);
    if (planId) await this.plans.requireAssignable(userId, planId);
    const row = await this.store.updateLive(userId, id, {
      status: ClientStatus.ACTIVE,
      ...(planId ? { planId } : {}),
    });
    return toClientView(row);
  }

  async generateAvatarUploadUrl(
    userId: string,
    id: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    await this.directory.requireOwned(userId, id);
    const extension = contentType.split("/")[1];
    return this.gcs.generateSignedUploadUrl(
      `avatars/${userId}/${id}.${extension}`,
      contentType,
    );
  }

  /**
   * Soft delete: one update, nothing else is touched (plan link, payments, events,
   * sheets and assessments stay). A second call answers 404.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.directory.requireOwned(userId, id);
    const { count } = await this.prisma.client.updateMany({
      where: { id, userId, ...NOT_DELETED },
      data: {
        deletedAt: new Date(),
        subscriptionStatus: SubscriptionStatus.CANCELED,
      },
    });
    if (count === 0) throw new NotFoundException(`Client #${id} not found`);
  }
}
