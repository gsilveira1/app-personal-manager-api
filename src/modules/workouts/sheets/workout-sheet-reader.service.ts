import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ActiveSheetSummary,
  WorkoutSegmentRef,
  WorkoutSegmentSummary,
  WorkoutSheetReader,
} from "../../../common/ports";
import {
  findWorkoutItem,
  readWorkoutStructure,
  WorkoutSheetStructure,
} from "../../../common/types";
import { PrismaService } from "../../prisma/prisma.service";

/** Implementation of the `WORKOUT_SHEET_READER` port (consumed by crm and calendar). */
@Injectable()
export class WorkoutSheetReaderService implements WorkoutSheetReader {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveSummaries(
    userId: string,
    clientIds: readonly string[],
  ): Promise<Map<string, ActiveSheetSummary>> {
    const summaries = new Map<string, ActiveSheetSummary>();
    if (clientIds.length === 0) return summaries;
    const sheets = await this.prisma.workoutSheet.findMany({
      where: {
        userId,
        clientId: { in: [...clientIds] },
        active: true,
        isTemplate: false,
      },
      select: { id: true, name: true, expiresAt: true, clientId: true },
    });
    for (const { clientId, ...summary } of sheets) {
      if (clientId) summaries.set(clientId, summary);
    }
    return summaries;
  }

  async resolveSegments(
    userId: string,
    refs: readonly WorkoutSegmentRef[],
  ): Promise<WorkoutSegmentSummary[]> {
    if (refs.length === 0) return [];
    const sheetIds = [...new Set(refs.map((ref) => ref.sheetId))];
    const sheets = await this.prisma.workoutSheet.findMany({
      where: { userId, id: { in: sheetIds } },
      select: { id: true, structure: true },
    });
    const structures = new Map<string, WorkoutSheetStructure>(
      sheets.map((s) => [s.id, readWorkoutStructure(s.structure, s.id)]),
    );
    return refs.flatMap(({ sheetId, segmentId }) => {
      const structure = structures.get(sheetId);
      const item = structure ? findWorkoutItem(structure, segmentId) : null;
      // A pointer that no longer resolves is legal (contract 5.2) and reads as "no workout linked".
      if (!item) return [];
      return [{ sheetId, segmentId, name: item.name, letter: item.letter }];
    });
  }

  async assertSegment(
    userId: string,
    ref: { sheetId: string; segmentId?: string | null },
  ): Promise<void> {
    const sheet = await this.prisma.workoutSheet.findUnique({
      where: { id: ref.sheetId },
      select: { id: true, userId: true, structure: true },
    });
    if (!sheet || sheet.userId !== userId) {
      throw new NotFoundException(`Ficha #${ref.sheetId} não encontrada`);
    }
    if (!ref.segmentId) return;
    const structure = readWorkoutStructure(sheet.structure, sheet.id);
    if (!findWorkoutItem(structure, ref.segmentId)) {
      throw new BadRequestException(
        `Treino "${ref.segmentId}" não pertence à ficha #${ref.sheetId}`,
      );
    }
  }
}
