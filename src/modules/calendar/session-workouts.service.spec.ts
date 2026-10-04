import { BadRequestException, NotFoundException } from "@nestjs/common";

import { WorkoutSheetReader } from "../../common/ports";
import { SessionView } from "./calendar.types";
import { SessionWorkoutsService } from "./session-workouts.service";

describe("SessionWorkoutsService", () => {
  let sheets: jest.Mocked<WorkoutSheetReader>;
  let service: SessionWorkoutsService;

  const view = (overrides: Partial<SessionView>): SessionView =>
    ({
      id: "s",
      workoutSheetId: null,
      workoutSegmentId: null,
      workout: null,
      ...overrides,
    }) as SessionView;

  beforeEach(() => {
    sheets = {
      findActiveSummaries: jest.fn(),
      resolveSegments: jest.fn().mockResolvedValue([]),
      assertSegment: jest.fn().mockResolvedValue(undefined),
    };
    service = new SessionWorkoutsService(sheets);
  });

  describe("assertLink", () => {
    it("accepts no link without calling the reader", async () => {
      await service.assertLink("u1", null, null);
      expect(sheets.assertSegment).not.toHaveBeenCalled();
    });

    it("validates a sheet + segment through the port", async () => {
      await service.assertLink("u1", "sheet-1", "item-a");
      expect(sheets.assertSegment).toHaveBeenCalledWith("u1", {
        sheetId: "sheet-1",
        segmentId: "item-a",
      });
    });

    it("validates a sheet without segment", async () => {
      await service.assertLink("u1", "sheet-1", null);
      expect(sheets.assertSegment).toHaveBeenCalledWith("u1", {
        sheetId: "sheet-1",
        segmentId: null,
      });
    });

    it("answers 400 for a segment without a sheet", async () => {
      await expect(service.assertLink("u1", null, "item-a")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("propagates the port's 404", async () => {
      sheets.assertSegment.mockRejectedValue(new NotFoundException());
      await expect(service.assertLink("u1", "sheet-x", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("attach", () => {
    it("does not call the reader when no view has a full pointer", async () => {
      const views = [view({}), view({ workoutSheetId: "sheet-1" })];

      expect(await service.attach("u1", views)).toEqual(views);
      expect(sheets.resolveSegments).not.toHaveBeenCalled();
    });

    it("resolves every pointer with one call, deduplicated", async () => {
      sheets.resolveSegments.mockResolvedValue([
        { sheetId: "sheet-1", segmentId: "item-a", name: "Peito", letter: "A" },
      ]);
      const views = [
        view({
          id: "1",
          workoutSheetId: "sheet-1",
          workoutSegmentId: "item-a",
        }),
        view({
          id: "2",
          workoutSheetId: "sheet-1",
          workoutSegmentId: "item-a",
        }),
        view({
          id: "3",
          workoutSheetId: "sheet-1",
          workoutSegmentId: "item-b",
        }),
        view({ id: "4" }),
      ];

      const result = await service.attach("u1", views);

      expect(sheets.resolveSegments).toHaveBeenCalledTimes(1);
      expect(sheets.resolveSegments).toHaveBeenCalledWith("u1", [
        { sheetId: "sheet-1", segmentId: "item-a" },
        { sheetId: "sheet-1", segmentId: "item-b" },
      ]);
      const workout = { id: "item-a", name: "Peito", letter: "A" };
      expect(result.map((v) => v.workout)).toEqual([
        workout,
        workout,
        null,
        null,
      ]);
    });

    it("propagates a failure of the reader instead of hiding the workouts", async () => {
      sheets.resolveSegments.mockRejectedValue(new Error("db down"));
      const views = [
        view({ workoutSheetId: "sheet-1", workoutSegmentId: "item-a" }),
      ];

      await expect(service.attach("u1", views)).rejects.toThrow("db down");
    });
  });
});
