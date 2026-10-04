const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WORKOUT_NAME = "Treino Realizado";

export interface HeatmapSession {
  completedAt: Date;
  workoutName: string | null;
  durationSeconds: number;
}

export interface HeatmapDay {
  date: string;
  status: "COMPLETED" | "EXPIRED" | "NO_ACTIVITY";
  workoutName?: string;
  durationMinutes?: number;
}

/** Response of `GET /clients/:id/activity-heatmap` (shape unchanged from v1). */
export interface ActivityHeatmap {
  studentId: string;
  totalCompletedMonth: number;
  /** Longest run of consecutive days with a workout inside the window (as in v1). */
  currentStreak: number;
  lastWorkoutDate: string | null;
  days: HeatmapDay[];
}

/** "YYYY-MM-DD" of the UTC day. */
function dayKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

function startOfUtcDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

/**
 * @returns First instant of the window the heatmap reads sessions from
 *
 * @example
 * prisma.studentSession.findMany({ where: { completedAt: { gte: heatmapWindowStart(now, 30) } } })
 */
export function heatmapWindowStart(now: Date, days: number): Date {
  return new Date(startOfUtcDay(now).getTime() - days * DAY_MS);
}

/** The last session of each day wins (sessions arrive ordered by `completedAt` asc). */
function indexByDay(
  sessions: readonly HeatmapSession[],
): Map<string, HeatmapDay> {
  const byDay = new Map<string, HeatmapDay>();
  for (const session of sessions) {
    const date = dayKey(session.completedAt);
    byDay.set(date, {
      date,
      status: "COMPLETED",
      workoutName: session.workoutName || DEFAULT_WORKOUT_NAME,
      durationMinutes: Math.round(session.durationSeconds / 60),
    });
  }
  return byDay;
}

/**
 * One entry per day of the last `days` days (today included), oldest first.
 *
 * @param sessions - The client's sessions since {@link heatmapWindowStart}, oldest first
 *
 * @example
 * buildActivityHeatmap(clientId, sessions, 30, new Date())
 */
export function buildActivityHeatmap(
  clientId: string,
  sessions: readonly HeatmapSession[],
  days: number,
  now: Date,
): ActivityHeatmap {
  const completedByDay = indexByDay(sessions);
  const today = startOfUtcDay(now).getTime();
  const heatmap: ActivityHeatmap = {
    studentId: clientId,
    totalCompletedMonth: 0,
    currentStreak: 0,
    lastWorkoutDate: null,
    days: [],
  };
  let runningStreak = 0;
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = dayKey(new Date(today - offset * DAY_MS));
    const completed = completedByDay.get(date);
    heatmap.days.push(completed ?? { date, status: "NO_ACTIVITY" });
    runningStreak = completed ? runningStreak + 1 : 0;
    if (!completed) continue;
    heatmap.totalCompletedMonth++;
    heatmap.currentStreak = Math.max(heatmap.currentStreak, runningStreak);
    heatmap.lastWorkoutDate = `${date}T10:00:00.000Z`;
  }
  return heatmap;
}
