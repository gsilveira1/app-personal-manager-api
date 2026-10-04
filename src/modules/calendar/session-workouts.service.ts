import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import {
  WORKOUT_SHEET_READER,
  WorkoutSegmentRef,
  WorkoutSheetReader,
} from "../../common/ports";
import { SessionView } from "./calendar.types";

const refKey = (sheetId: string, segmentId: string) =>
  `${sheetId}:${segmentId}`;

/** The link between a session and a workout (`workoutSheetId` + `workoutSegmentId`). */
@Injectable()
export class SessionWorkoutsService {
  constructor(
    @Inject(WORKOUT_SHEET_READER) private readonly sheets: WorkoutSheetReader,
  ) {}

  /**
   * Validates a link before it is stored. No sheet and no segment is a valid "no link".
   *
   * @throws {BadRequestException} When a segment is given without a sheet, or is not an item of the sheet
   * @throws {NotFoundException} When the sheet does not exist or belongs to another trainer
   */
  async assertLink(
    userId: string,
    sheetId: string | null,
    segmentId: string | null,
  ): Promise<void> {
    if (!sheetId) {
      if (segmentId) {
        throw new BadRequestException(
          "workoutSegmentId requires workoutSheetId",
        );
      }
      return;
    }
    await this.sheets.assertSegment(userId, { sheetId, segmentId });
  }

  /**
   * Fills `workout` on every view with one `resolveSegments` call. A pointer that no
   * longer resolves reads as "no workout linked" (contract 5.2).
   */
  async attach(userId: string, views: SessionView[]): Promise<SessionView[]> {
    const refs = this.collectRefs(views);
    if (refs.length === 0) return views;

    const resolved = await this.sheets.resolveSegments(userId, refs);
    const byRef = new Map(
      resolved.map((segment) => [
        refKey(segment.sheetId, segment.segmentId),
        segment,
      ]),
    );

    return views.map((view) => {
      const segment =
        view.workoutSheetId && view.workoutSegmentId
          ? byRef.get(refKey(view.workoutSheetId, view.workoutSegmentId))
          : undefined;
      if (!segment) return view;
      return {
        ...view,
        workout: {
          id: segment.segmentId,
          name: segment.name,
          letter: segment.letter,
        },
      };
    });
  }

  private collectRefs(views: SessionView[]): WorkoutSegmentRef[] {
    const refs = new Map<string, WorkoutSegmentRef>();
    for (const view of views) {
      if (!view.workoutSheetId || !view.workoutSegmentId) continue;
      refs.set(refKey(view.workoutSheetId, view.workoutSegmentId), {
        sheetId: view.workoutSheetId,
        segmentId: view.workoutSegmentId,
      });
    }
    return [...refs.values()];
  }
}
