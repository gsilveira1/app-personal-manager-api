import { buildActivityHeatmap, heatmapWindowStart } from "./activity-heatmap";

const NOW = new Date("2026-10-03T15:30:00Z");
const session = (iso: string, overrides: object = {}) => ({
  completedAt: new Date(iso),
  workoutName: "Treino A - Peito",
  durationSeconds: 3000,
  ...overrides,
});

describe("heatmapWindowStart", () => {
  it("is midnight (UTC) `days` days ago", () => {
    expect(heatmapWindowStart(NOW, 30)).toEqual(
      new Date("2026-09-03T00:00:00Z"),
    );
  });
});

describe("buildActivityHeatmap", () => {
  it("returns one entry per day, oldest first, ending today", () => {
    const result = buildActivityHeatmap("client-1", [], 3, NOW);

    expect(result).toEqual({
      studentId: "client-1",
      totalCompletedMonth: 0,
      currentStreak: 0,
      lastWorkoutDate: null,
      days: [
        { date: "2026-10-01", status: "NO_ACTIVITY" },
        { date: "2026-10-02", status: "NO_ACTIVITY" },
        { date: "2026-10-03", status: "NO_ACTIVITY" },
      ],
    });
  });

  it("marks days with a session as COMPLETED with name and rounded minutes", () => {
    const result = buildActivityHeatmap(
      "client-1",
      [session("2026-10-02T09:00:00Z", { durationSeconds: 3090 })],
      3,
      NOW,
    );

    expect(result.days[1]).toEqual({
      date: "2026-10-02",
      status: "COMPLETED",
      workoutName: "Treino A - Peito",
      durationMinutes: 52,
    });
    expect(result.totalCompletedMonth).toBe(1);
    expect(result.lastWorkoutDate).toBe("2026-10-02T10:00:00.000Z");
  });

  it("falls back to 'Treino Realizado' when the session has no name", () => {
    const result = buildActivityHeatmap(
      "client-1",
      [session("2026-10-03T09:00:00Z", { workoutName: null })],
      1,
      NOW,
    );

    expect(result.days[0].workoutName).toBe("Treino Realizado");
  });

  it("counts a day once and keeps its last session when there are two", () => {
    const result = buildActivityHeatmap(
      "client-1",
      [
        session("2026-10-03T08:00:00Z", { workoutName: "Manhã" }),
        session("2026-10-03T14:00:00Z", { workoutName: "Tarde" }),
      ],
      2,
      NOW,
    );

    expect(result.totalCompletedMonth).toBe(1);
    expect(result.days[1].workoutName).toBe("Tarde");
  });

  it("reports the longest streak of the window (v1 behaviour)", () => {
    const result = buildActivityHeatmap(
      "client-1",
      [
        session("2026-09-27T09:00:00Z"),
        session("2026-09-28T09:00:00Z"),
        session("2026-09-29T09:00:00Z"),
        session("2026-10-02T09:00:00Z"),
      ],
      7,
      NOW,
    );

    expect(result.currentStreak).toBe(3);
    expect(result.totalCompletedMonth).toBe(4);
    expect(result.lastWorkoutDate).toBe("2026-10-02T10:00:00.000Z");
  });

  it("ignores sessions outside the window", () => {
    const result = buildActivityHeatmap(
      "client-1",
      [session("2026-09-01T09:00:00Z")],
      3,
      NOW,
    );

    expect(result.totalCompletedMonth).toBe(0);
  });
});
