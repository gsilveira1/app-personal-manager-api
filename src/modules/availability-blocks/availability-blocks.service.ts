import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { expandRRuleForRange } from '../../utils/rrule-expander';
import {
  CreateAvailabilityBlockDto,
  UpdateAvailabilityBlockDto,
} from './availability-blocks.dto';

export interface MaterializedBlock {
  id: string;
  blockId: string;
  title: string;
  start: string;
  end: string;
  isRecurring: boolean;
  notes: string | null;
}

@Injectable()
export class AvailabilityBlocksService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateAvailabilityBlockDto) {
    return this.prisma.availabilityBlock.create({
      data: {
        title: dto.title,
        rrule: dto.rrule ?? null,
        timezone: dto.timezone ?? 'America/Sao_Paulo',
        dtstart: new Date(dto.dtstart),
        dtend: new Date(dto.dtend),
        notes: dto.notes ?? null,
        userId,
      },
    });
  }

  async findAllForRange(userId: string, start: Date, end: Date) {
    return this.materializeBlocksForRange(userId, start, end);
  }

  async update(userId: string, id: string, dto: UpdateAvailabilityBlockDto) {
    const block = await this.prisma.availabilityBlock.findUnique({
      where: { id },
    });
    if (!block) throw new NotFoundException('Block not found');
    if (block.userId !== userId) throw new ForbiddenException();

    return this.prisma.availabilityBlock.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.rrule !== undefined && { rrule: dto.rrule }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.dtstart !== undefined && { dtstart: new Date(dto.dtstart) }),
        ...(dto.dtend !== undefined && { dtend: new Date(dto.dtend) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async remove(userId: string, id: string) {
    const block = await this.prisma.availabilityBlock.findUnique({
      where: { id },
    });
    if (!block) throw new NotFoundException('Block not found');
    if (block.userId !== userId) throw new ForbiddenException();

    return this.prisma.availabilityBlock.delete({ where: { id } });
  }

  /**
   * Materialize availability blocks for a time range.
   * Recurring blocks are expanded via RRULE; one-off blocks use direct overlap.
   */
  async materializeBlocksForRange(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<MaterializedBlock[]> {
    const blocks = await this.prisma.availabilityBlock.findMany({
      where: {
        userId,
        dtstart: { lte: rangeEnd },
      },
    });

    const materialized: MaterializedBlock[] = [];

    for (const block of blocks) {
      const durationMs =
        new Date(block.dtend).getTime() - new Date(block.dtstart).getTime();

      if (block.rrule) {
        // Recurring block — expand via RRULE
        let occurrences: Date[];
        try {
          occurrences = expandRRuleForRange(
            block.rrule,
            block.dtstart,
            block.timezone,
            rangeStart,
            rangeEnd,
          );
        } catch {
          continue; // Skip malformed rules
        }

        for (const occurrence of occurrences) {
          const occEnd = new Date(occurrence.getTime() + durationMs);
          materialized.push({
            id: `${block.id}_${occurrence.toISOString()}`,
            blockId: block.id,
            title: block.title,
            start: occurrence.toISOString(),
            end: occEnd.toISOString(),
            isRecurring: true,
            notes: block.notes,
          });
        }
      } else {
        // One-off block — check direct overlap with range
        const blockStart = new Date(block.dtstart);
        const blockEnd = new Date(block.dtend);

        if (blockStart <= rangeEnd && blockEnd >= rangeStart) {
          materialized.push({
            id: block.id,
            blockId: block.id,
            title: block.title,
            start: blockStart.toISOString(),
            end: blockEnd.toISOString(),
            isRecurring: false,
            notes: block.notes,
          });
        }
      }
    }

    return materialized;
  }
}
