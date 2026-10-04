import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WorkoutSheet } from "@prisma/client";
import { CLIENT_DIRECTORY, ClientDirectory } from "../../../common/ports";
import {
  OF_LIVE_CLIENT,
  WITHOUT_DELETED_CLIENT,
} from "../../../common/prisma/soft-delete";
import {
  buildWorkoutStructure,
  readWorkoutStructure,
  toJsonValue,
} from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateSheetDto,
  CreateTemplateDto,
  SaveAsTemplateDto,
  UpdateSheetDto,
} from "./sheet.dto";
import {
  ExpiringSheetView,
  toSheetView,
  toStructureInput,
  WorkoutSheetView,
} from "./sheet.view";

const EXPIRING_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
/** The first attempt plus one retry (contract 6.3, "P2002 → retry once, then 409"). */
const CREATE_ATTEMPTS = 2;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

@Injectable()
export class WorkoutSheetsService {
  private readonly logger = new Logger(WorkoutSheetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
  ) {}

  /**
   * Creates the client's new active sheet; the previous active ones are deactivated in
   * the same transaction.
   *
   * @throws {NotFoundException | ForbiddenException} From the client ownership check
   * @throws {BadRequestException} Invalid structure (BISET/TRISET size, duplicate ids)
   * @throws {ConflictException} When concurrent creates keep winning the one-active-sheet index
   *
   * @example
   * await sheets.createForClient(userId, clientId, { name: "Ficha A", workouts });
   */
  async createForClient(
    userId: string,
    clientId: string,
    dto: CreateSheetDto,
  ): Promise<WorkoutSheetView> {
    await this.clients.requireOwned(userId, clientId);
    const data: Prisma.WorkoutSheetUncheckedCreateInput = {
      name: dto.name,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      active: true,
      isTemplate: false,
      clientId,
      userId,
      structure: toJsonValue(buildWorkoutStructure(dto)),
    };
    for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt++) {
      try {
        return toSheetView(await this.replaceActiveSheet(clientId, data));
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        this.logger.warn(
          `Active-sheet race for client ${clientId} (P2002), attempt ${attempt}/${CREATE_ATTEMPTS}`,
        );
      }
    }
    throw new ConflictException(
      "Outra ficha foi ativada para este aluno ao mesmo tempo. Tente novamente.",
    );
  }

  private replaceActiveSheet(
    clientId: string,
    data: Prisma.WorkoutSheetUncheckedCreateInput,
  ): Promise<WorkoutSheet> {
    return this.prisma.$transaction(async (tx) => {
      await tx.workoutSheet.updateMany({
        where: { clientId, active: true, isTemplate: false },
        data: { active: false },
      });
      return tx.workoutSheet.create({ data });
    });
  }

  /** @throws {NotFoundException | ForbiddenException} From the client ownership check */
  async findByClient(
    userId: string,
    clientId: string,
  ): Promise<WorkoutSheetView[]> {
    await this.clients.requireOwned(userId, clientId);
    const sheets = await this.prisma.workoutSheet.findMany({
      where: { clientId, userId, isTemplate: false },
      orderBy: { createdAt: "desc" },
    });
    return sheets.map(toSheetView);
  }

  /**
   * Client sheet or template, by id.
   * @throws {NotFoundException} Unknown id, or sheet of a soft-deleted client
   * @throws {ForbiddenException} Sheet of another trainer
   */
  async findOne(userId: string, id: string): Promise<WorkoutSheetView> {
    return toSheetView(await this.requireOwnedSheet(userId, id));
  }

  private async requireOwnedSheet(
    userId: string,
    id: string,
  ): Promise<WorkoutSheet> {
    const sheet = await this.prisma.workoutSheet.findFirst({
      where: { id, ...WITHOUT_DELETED_CLIENT },
    });
    if (!sheet) throw new NotFoundException(`Ficha #${id} não encontrada`);
    if (sheet.userId !== userId) throw new ForbiddenException("Acesso negado");
    return sheet;
  }

  /**
   * `workouts` replaces every item; `description` / `tags` alone patch only those keys.
   * Whatever changes, the stored document is rebuilt through `buildWorkoutStructure`.
   *
   * @throws {BadRequestException} Invalid structure
   * @throws {NotFoundException | ForbiddenException} See {@link findOne}
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateSheetDto,
  ): Promise<WorkoutSheetView> {
    const sheet = await this.requireOwnedSheet(userId, id);
    const data: Prisma.WorkoutSheetUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    }
    if (
      [dto.workouts, dto.description, dto.tags].some((v) => v !== undefined)
    ) {
      data.structure = this.mergeStructure(sheet, dto);
    }
    const updated = await this.prisma.workoutSheet.update({
      where: { id, userId },
      data,
    });
    return toSheetView(updated);
  }

  private mergeStructure(
    sheet: WorkoutSheet,
    dto: UpdateSheetDto,
  ): Prisma.InputJsonValue {
    const current = toStructureInput(
      readWorkoutStructure(sheet.structure, sheet.id),
    );
    return toJsonValue(
      buildWorkoutStructure({
        workouts: dto.workouts ?? current.workouts,
        description: dto.description ?? current.description,
        tags: dto.tags ?? current.tags,
      }),
    );
  }

  /** @throws {NotFoundException | ForbiddenException} See {@link findOne} */
  async remove(userId: string, id: string): Promise<{ message: string }> {
    await this.requireOwnedSheet(userId, id);
    await this.prisma.workoutSheet.delete({ where: { id, userId } });
    return { message: "Ficha excluída com sucesso" };
  }

  async findTemplates(userId: string): Promise<WorkoutSheetView[]> {
    const templates = await this.prisma.workoutSheet.findMany({
      where: { userId, isTemplate: true },
      orderBy: { createdAt: "desc" },
    });
    return templates.map(toSheetView);
  }

  /** @throws {BadRequestException} Invalid structure */
  async createTemplate(
    userId: string,
    dto: CreateTemplateDto,
  ): Promise<WorkoutSheetView> {
    return this.insertTemplate(userId, dto.name, buildWorkoutStructure(dto));
  }

  /**
   * Copies a sheet (ids included) into a new template.
   * @throws {NotFoundException | ForbiddenException} See {@link findOne}
   */
  async saveAsTemplate(
    userId: string,
    sheetId: string,
    dto: SaveAsTemplateDto,
  ): Promise<WorkoutSheetView> {
    const source = await this.requireOwnedSheet(userId, sheetId);
    const input = toStructureInput(
      readWorkoutStructure(source.structure, source.id),
    );
    const structure = buildWorkoutStructure({
      ...input,
      description: dto.description ?? input.description,
    });
    return this.insertTemplate(userId, dto.name, structure);
  }

  private async insertTemplate(
    userId: string,
    name: string,
    structure: object,
  ): Promise<WorkoutSheetView> {
    const created = await this.prisma.workoutSheet.create({
      data: {
        name,
        expiresAt: null,
        active: true,
        isTemplate: true,
        clientId: null,
        userId,
        structure: toJsonValue(structure),
      },
    });
    return toSheetView(created);
  }

  /**
   * Active sheets of live clients that expire within the next 5 days, soonest first.
   *
   * @example
   * const alerts = await sheets.findExpiring(userId);
   */
  async findExpiring(userId: string): Promise<ExpiringSheetView[]> {
    const now = new Date();
    const sheets = await this.prisma.workoutSheet.findMany({
      where: {
        userId,
        active: true,
        isTemplate: false,
        expiresAt: {
          gte: now,
          lte: new Date(now.getTime() + EXPIRING_WINDOW_MS),
        },
        ...OF_LIVE_CLIENT,
      },
      orderBy: { expiresAt: "asc" },
    });
    const clientIds = [...new Set(sheets.map((s) => s.clientId as string))];
    const clients = await this.clients.findManyOwned(userId, clientIds);
    return sheets.flatMap((sheet) => {
      const client = clients.get(sheet.clientId as string);
      if (!client) {
        this.logger.warn(
          `Expiring sheet ${sheet.id} left out: client ${sheet.clientId} is no longer visible`,
        );
        return [];
      }
      const { id, name, avatar, phone } = client;
      return [
        {
          client: { id, name, avatar, phone },
          sheet: {
            id: sheet.id,
            name: sheet.name,
            expiresAt: sheet.expiresAt as Date,
          },
        },
      ];
    });
  }
}
