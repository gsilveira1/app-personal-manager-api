/** Injection token. Provided and exported by WorkoutsModule. */
export const WORKOUT_SHEET_READER = Symbol("WORKOUT_SHEET_READER");

export interface ActiveSheetSummary {
  id: string;
  name: string;
  expiresAt: Date | null;
}

/** Pointer stored on Event: `workoutSheetId` + `workoutSegmentId`. */
export interface WorkoutSegmentRef {
  sheetId: string;
  segmentId: string;
}

export interface WorkoutSegmentSummary extends WorkoutSegmentRef {
  name: string;
  letter: string;
}

/**
 * Read-only view of WorkoutSheet for crm (client lists) and calendar (session cards).
 *
 * @example
 * const active = await this.sheets.findActiveSummaries(userId, clients.map((c) => c.id));
 */
export interface WorkoutSheetReader {
  /** Active (non-template) sheet of each client, in one query. Clients without one are absent. */
  findActiveSummaries(
    userId: string,
    clientIds: readonly string[],
  ): Promise<Map<string, ActiveSheetSummary>>;

  /**
   * Resolves many segment pointers in one query. Pointers that no longer resolve
   * (sheet deleted, item removed by an edit, sheet of another trainer) are left out.
   */
  resolveSegments(
    userId: string,
    refs: readonly WorkoutSegmentRef[],
  ): Promise<WorkoutSegmentSummary[]>;

  /**
   * Validation before an Event is linked to a sheet.
   * @throws {NotFoundException} When the sheet does not exist or belongs to another trainer
   * @throws {BadRequestException} When `segmentId` is given and is not an item of that sheet
   */
  assertSegment(
    userId: string,
    ref: { sheetId: string; segmentId?: string | null },
  ): Promise<void>;
}
