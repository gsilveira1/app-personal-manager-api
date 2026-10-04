import {
  buildWorkoutStructure,
  WorkoutSheetStructure,
  WorkoutStructureInputDto,
} from "../../../common/types";

/** Test fixtures shared by the workouts specs. Not imported by production code. */

export const SHEET_INPUT: WorkoutStructureInputDto = {
  workouts: [
    {
      id: "w-1",
      letter: "A",
      name: "Peito",
      blocks: [
        {
          id: "b-1",
          type: "REGULAR",
          restTimeSeconds: 60,
          exercises: [
            {
              id: "we-1",
              exerciseName: "Supino",
              sets: 4,
              reps: "10",
              suggestedLoadKg: 50,
            },
            { id: "we-2", exerciseName: "Crucifixo" },
          ],
        },
      ],
    },
  ],
};

export function structureFixture(
  input: WorkoutStructureInputDto = SHEET_INPUT,
): WorkoutSheetStructure {
  return buildWorkoutStructure(input);
}

export function sheetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sheet-1",
    name: "Ficha A",
    expiresAt: null as Date | null,
    active: true,
    isTemplate: false,
    structure: structureFixture() as unknown,
    clientId: "client-1" as string | null,
    userId: "user-1",
    createdAt: new Date("2026-09-01T12:00:00Z"),
    updatedAt: new Date("2026-09-01T12:00:00Z"),
    ...overrides,
  };
}

export function clientSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-1",
    userId: "user-1",
    name: "Mariana",
    email: "mariana@example.com",
    phone: "+5511999998888",
    avatar: null,
    status: "ACTIVE",
    dateOfBirth: null,
    notificationEnabled: true,
    ...overrides,
  };
}

export function trainerProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Viviana Trainer",
    phone: "+5511977776666",
    slug: "viviana",
    status: "ACTIVE",
    primaryColor: "#10B981",
    logoUrl: null,
    ...overrides,
  };
}
