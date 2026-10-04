import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Event, EventType, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import {
  BlockView,
  DEFAULT_TIMEZONE,
  MaterializedBlock,
  MS_PER_MINUTE,
} from "./calendar.types";
import {
  CreateAvailabilityBlockDto,
  UpdateAvailabilityBlockDto,
} from "./dto/availability-block.dto";
import { ownedWrite } from "./owned-write";
import {
  assertValidRRule,
  expandRRuleForRange,
  RRuleExpansionLimitError,
} from "./rrule-expander";

const BLOCK_NOT_FOUND = "Block not found";

const blockEnd = (block: Event) =>
  new Date(block.date.getTime() + block.durationMinutes * MS_PER_MINUTE);

/**
 * Minutes between the two instants, rounded up.
 *
 * @throws {BadRequestException} When the block would last less than one minute
 */
function durationBetween(dtstart: Date, dtend: Date): number {
  const minutes = Math.ceil(
    (dtend.getTime() - dtstart.getTime()) / MS_PER_MINUTE,
  );
  if (minutes < 1) {
    throw new BadRequestException("dtend must be after dtstart");
  }
  return minutes;
}

function toBlockView(block: Event): BlockView {
  return {
    id: block.id,
    title: block.title ?? "",
    rrule: block.rrule,
    timezone: block.timezone,
    dtstart: block.date.toISOString(),
    dtend: blockEnd(block).toISOString(),
    notes: block.notes,
    userId: block.userId,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  };
}

/** Availability blocks: Event rows of type BLOCK that end at `date + durationMinutes`. */
@Injectable()
export class AvailabilityBlocksService {
  private readonly logger = new Logger(AvailabilityBlocksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @example
   * await blocks.create(userId, { title: "Almoço", dtstart: "2025-01-15T12:00:00Z", dtend: "2025-01-15T13:00:00Z" });
   *
   * @throws {BadRequestException} When `dtend` is not after `dtstart` or the rule is invalid
   */
  async create(
    userId: string,
    dto: CreateAvailabilityBlockDto,
  ): Promise<BlockView> {
    const dtstart = new Date(dto.dtstart);
    if (dto.rrule) assertValidRRule(dto.rrule, dtstart);

    const block = await this.prisma.event.create({
      data: {
        type: EventType.BLOCK,
        title: dto.title,
        rrule: dto.rrule ?? null,
        timezone: dto.timezone ?? DEFAULT_TIMEZONE,
        date: dtstart,
        durationMinutes: durationBetween(dtstart, new Date(dto.dtend)),
        notes: dto.notes ?? null,
        userId,
      },
    });
    return toBlockView(block);
  }

  findAllForRange(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<MaterializedBlock[]> {
    return this.materializeBlocksForRange(userId, start, end);
  }

  /**
   * @throws {NotFoundException} When the block does not exist
   * @throws {ForbiddenException} When it belongs to another trainer
   * @throws {BadRequestException} When the resulting block would not end after it
   * starts, or its rule (new, or kept with a new `dtstart`) is not acceptable
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateAvailabilityBlockDto,
  ): Promise<BlockView> {
    const block = await this.requireOwned(userId, id);
    this.assertResultingRule(block, dto);

    const updated = await ownedWrite(
      this.prisma.event.update({
        where: { id, userId },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.rrule !== undefined && { rrule: dto.rrule }),
          ...(dto.timezone !== undefined && { timezone: dto.timezone }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...this.movedBounds(block, dto),
        },
      }),
      BLOCK_NOT_FOUND,
    );
    return toBlockView(updated);
  }

  /** The rule is validated against the DTSTART it will have after the update. */
  private assertResultingRule(
    block: Event,
    dto: UpdateAvailabilityBlockDto,
  ): void {
    const rrule = dto.rrule !== undefined ? dto.rrule : block.rrule;
    const changed = dto.rrule !== undefined || dto.dtstart !== undefined;
    if (!rrule || !changed) return;
    assertValidRRule(rrule, dto.dtstart ? new Date(dto.dtstart) : block.date);
  }

  /** `dtstart` and `dtend` move independently: changing one keeps the other instant. */
  private movedBounds(block: Event, dto: UpdateAvailabilityBlockDto) {
    if (dto.dtstart === undefined && dto.dtend === undefined) return {};
    const dtstart = dto.dtstart ? new Date(dto.dtstart) : block.date;
    const dtend = dto.dtend ? new Date(dto.dtend) : blockEnd(block);
    return { date: dtstart, durationMinutes: durationBetween(dtstart, dtend) };
  }

  /**
   * @throws {NotFoundException} When the block does not exist
   * @throws {ForbiddenException} When it belongs to another trainer
   */
  async remove(userId: string, id: string): Promise<BlockView> {
    await this.requireOwned(userId, id);
    const deleted = await ownedWrite(
      this.prisma.event.delete({ where: { id, userId } }),
      BLOCK_NOT_FOUND,
    );
    return toBlockView(deleted);
  }

  /**
   * Materialize availability blocks for a time range.
   * Recurring blocks are expanded via RRULE; one-off blocks use direct overlap.
   *
   * @param db - Client to read with; pass the transaction client to read inside a transaction
   * @throws {RRuleExpansionLimitError} When one block yields more occurrences than the cap
   */
  async materializeBlocksForRange(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<MaterializedBlock[]> {
    const blocks = await db.event.findMany({
      where: { userId, type: EventType.BLOCK, date: { lte: rangeEnd } },
    });

    return blocks.flatMap((block) =>
      block.rrule
        ? this.expandRecurring(block, block.rrule, rangeStart, rangeEnd)
        : this.materializeOneOff(block, rangeStart, rangeEnd),
    );
  }

  private materializeOneOff(
    block: Event,
    rangeStart: Date,
    rangeEnd: Date,
  ): MaterializedBlock[] {
    const end = blockEnd(block);
    if (block.date > rangeEnd || end < rangeStart) return [];
    return [
      {
        id: block.id,
        blockId: block.id,
        title: block.title ?? "",
        start: block.date.toISOString(),
        end: end.toISOString(),
        isRecurring: false,
        notes: block.notes,
      },
    ];
  }

  private expandRecurring(
    block: Event,
    rrule: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): MaterializedBlock[] {
    const durationMs = block.durationMinutes * MS_PER_MINUTE;
    return this.expandRule(block, rrule, rangeStart, rangeEnd).map(
      (occurrence) => ({
        id: `${block.id}_${occurrence.toISOString()}`,
        blockId: block.id,
        title: block.title ?? "",
        start: occurrence.toISOString(),
        end: new Date(occurrence.getTime() + durationMs).toISOString(),
        isRecurring: true,
        notes: block.notes,
      }),
    );
  }

  /**
   * Rules are validated on write; a stored rule that is malformed or no longer accepted
   * is logged and left out. A rule that exceeds the occurrence cap fails the request.
   */
  private expandRule(
    block: Event,
    rrule: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Date[] {
    try {
      return expandRRuleForRange(
        rrule,
        block.date,
        block.timezone,
        rangeStart,
        rangeEnd,
      );
    } catch (error) {
      if (error instanceof RRuleExpansionLimitError) {
        this.logger.error(
          `Block ${block.id} (rrule "${rrule}") exceeds the occurrence cap between ${rangeStart.toISOString()} and ${rangeEnd.toISOString()}; the request was refused`,
        );
        throw error;
      }
      this.logger.error(
        `Block ${block.id} has a malformed rrule "${rrule}" and was left out: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async requireOwned(userId: string, id: string): Promise<Event> {
    const block = await this.prisma.event.findUnique({ where: { id } });
    if (!block || block.type !== EventType.BLOCK) {
      throw new NotFoundException(BLOCK_NOT_FOUND);
    }
    if (block.userId !== userId) throw new ForbiddenException();
    return block;
  }
}
