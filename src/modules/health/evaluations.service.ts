import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AssessmentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CLIENT_DIRECTORY,
  ClientDirectory,
  ClientSummary,
} from "../../common/ports";
import { OF_LIVE_CLIENT } from "../../common/prisma/soft-delete";
import {
  buildPhysicalEvaluationData,
  PhysicalEvaluationData,
  toJsonValue,
} from "../../common/types";
import {
  CalculationResult,
  EvaluationsCalculatorService,
} from "./evaluations-calculator.service";
import { CreateEvaluationDto, UpdateEvaluationDto } from "./dto/evaluation.dto";
import {
  CLIENT_DISPLAY,
  EvaluationRow,
  EvaluationView,
  readPhysicalEvaluationData,
  toEvaluationView,
} from "./assessment.views";

type Metrics = Omit<PhysicalEvaluationData, "version">;

const DEFAULT_PROTOCOL = "POLLOCK_3";
const DEFAULT_EQUATION = "SIRI";
/** Used when the client has no birth date (contract A14). */
const DEFAULT_AGE = 30;

const EVALUATION = { type: AssessmentType.PHYSICAL_EVALUATION } as const;

/**
 * The `where` of every write: the owner and the live-client filter are part of
 * the statement itself, not only of the check that precedes it.
 */
function ownedEvaluation(userId: string, id: string) {
  return { id, userId, ...EVALUATION, ...OF_LIVE_CLIENT };
}

function notFoundMessage(id: string): string {
  return `Avaliação #${id} não encontrada`;
}

function hasKeys(value: object | undefined | null): boolean {
  return !!value && Object.keys(value).length > 0;
}

/** Drops `undefined` values, so a partial patch never erases a stored key by accident. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Empty perimeter / skinfold objects are not stored. */
function dropEmptyGroups<T extends Partial<Metrics>>(metrics: T): T {
  const result = { ...metrics };
  if (!hasKeys(result.perimeters)) delete result.perimeters;
  if (!hasKeys(result.skinfolds)) delete result.skinfolds;
  return result;
}

function ageOf(client: Pick<ClientSummary, "dateOfBirth">): number {
  if (!client.dateOfBirth) return DEFAULT_AGE;
  return new Date().getFullYear() - new Date(client.dateOfBirth).getFullYear();
}

/** Physical evaluations: `Assessment` rows of type PHYSICAL_EVALUATION. */
@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: EvaluationsCalculatorService,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
  ) {}

  /**
   * @throws {NotFoundException} Client missing or soft-deleted
   * @throws {ForbiddenException} Client of another trainer
   * @throws {BadRequestException} Invalid metrics
   */
  async create(
    userId: string,
    dto: CreateEvaluationDto,
  ): Promise<EvaluationView> {
    const client = await this.clients.requireOwned(userId, dto.clientId);
    const { clientId, date, ...metrics } = dto;
    const data = buildPhysicalEvaluationData(
      this.composeForCreate(dropEmptyGroups({ ...metrics }), client),
    );
    const row = await this.prisma.assessment.create({
      data: {
        ...EVALUATION,
        userId,
        clientId,
        date: new Date(date),
        data: toJsonValue(data),
      },
    });
    return toEvaluationView(row);
  }

  /** The trainer's evaluations of live clients, newest evaluation date first. */
  async findAll(userId: string): Promise<EvaluationView[]> {
    const rows = await this.prisma.assessment.findMany({
      where: { userId, ...EVALUATION, ...OF_LIVE_CLIENT },
      include: { client: CLIENT_DISPLAY },
      orderBy: { date: "desc" },
    });
    return rows.map(toEvaluationView);
  }

  /**
   * @throws {NotFoundException} No such evaluation, or its client is soft-deleted
   * @throws {ForbiddenException} Evaluation of another trainer
   */
  async findOne(userId: string, id: string): Promise<EvaluationView> {
    return toEvaluationView(await this.requireOwnedRow(userId, id));
  }

  /**
   * Merges the patch over the stored metrics and recalculates body composition when
   * skinfolds and weight are available.
   *
   * @throws {NotFoundException} No such evaluation, or its client is soft-deleted
   * @throws {ForbiddenException} Evaluation of another trainer
   * @throws {BadRequestException} The merged document is invalid
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateEvaluationDto,
  ): Promise<EvaluationView> {
    const existing = await this.requireOwnedRow(userId, id);
    const client = await this.clients.requireOwned(userId, existing.clientId);
    const { date, ...patch } = dto;
    const { version: _version, ...stored } = readPhysicalEvaluationData(
      existing.data,
      id,
    );
    const data = buildPhysicalEvaluationData(
      this.composeForUpdate(stored, definedOnly(patch), client),
    );
    const [row] = await this.prisma.assessment.updateManyAndReturn({
      where: ownedEvaluation(userId, id),
      data: {
        data: toJsonValue(data),
        ...(date ? { date: new Date(date) } : {}),
      },
    });
    if (!row) throw new NotFoundException(notFoundMessage(id));
    return toEvaluationView(row);
  }

  /**
   * @throws {NotFoundException} No such evaluation, or its client is soft-deleted
   * @throws {ForbiddenException} Evaluation of another trainer
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwnedRow(userId, id);
    const { count } = await this.prisma.assessment.deleteMany({
      where: ownedEvaluation(userId, id),
    });
    if (count === 0) throw new NotFoundException(notFoundMessage(id));
  }

  private async requireOwnedRow(
    userId: string,
    id: string,
  ): Promise<EvaluationRow> {
    const row = await this.prisma.assessment.findFirst({
      where: { id, ...EVALUATION, ...OF_LIVE_CLIENT },
      include: { client: CLIENT_DISPLAY },
    });
    if (!row) {
      throw new NotFoundException(notFoundMessage(id));
    }
    if (row.userId !== userId) {
      throw new ForbiddenException("Acesso negado a esta avaliação.");
    }
    return row;
  }

  private canCalculate(metrics: Partial<Metrics>): boolean {
    return hasKeys(metrics.skinfolds) && (metrics.weight ?? 0) > 0;
  }

  private calculate(
    metrics: Metrics,
    client: Pick<ClientSummary, "dateOfBirth">,
  ): CalculationResult {
    return this.calculator.calculate({
      gender: "M", // Client has no gender column (contract A14)
      age: ageOf(client),
      weight: metrics.weight,
      height: metrics.height,
      skinfolds: metrics.skinfolds,
      perimeters: metrics.perimeters,
      protocol: metrics.protocol ?? DEFAULT_PROTOCOL,
      equation: metrics.equation ?? DEFAULT_EQUATION,
    });
  }

  private composeForCreate(
    input: Metrics,
    client: Pick<ClientSummary, "dateOfBirth">,
  ): Metrics {
    const metrics: Metrics = {
      ...input,
      protocol: input.protocol || DEFAULT_PROTOCOL,
      equation: input.equation || DEFAULT_EQUATION,
    };
    if (!this.canCalculate(metrics)) return metrics;
    const calculated = this.calculate(metrics, client);
    return {
      ...metrics,
      bodyFatPercentage:
        input.bodyFatPercentage || calculated.bodyFatPercentage,
      leanMass: input.leanMass || calculated.leanMass,
      fatMass: input.fatMass || calculated.fatMass,
      bodyDensity: input.bodyDensity || calculated.bodyDensity,
      protocol: calculated.protocolUsed,
      equation: calculated.equationUsed,
    };
  }

  private composeForUpdate(
    stored: Metrics,
    patch: Partial<Metrics>,
    client: Pick<ClientSummary, "dateOfBirth">,
  ): Metrics {
    const merged = dropEmptyGroups({ ...stored, ...patch });
    if (!this.canCalculate(merged)) return merged;
    const calculated = this.calculate(merged, client);
    return {
      ...merged,
      bodyFatPercentage:
        patch.bodyFatPercentage || calculated.bodyFatPercentage,
      leanMass: patch.leanMass || calculated.leanMass,
      fatMass: patch.fatMass || calculated.fatMass,
      bodyDensity: patch.bodyDensity || calculated.bodyDensity,
    };
  }
}
