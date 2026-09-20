import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateExerciseDto, ExerciseQueryDto } from "./dto/exercise.dto";

const GLOBAL_EXERCISES = [
  {
    id: "global-bench-press",
    name: "Barbell Bench Press",
    bodyPart: "chest",
    targetMuscle: "pectorals",
    equipment: "barbell",
    gifUrl: "https://pub-r2.com/exercises/bench-press.gif",
    isCustom: false,
  },
  {
    id: "global-squat",
    name: "Barbell Back Squat",
    bodyPart: "legs",
    targetMuscle: "quadriceps",
    equipment: "barbell",
    gifUrl: "https://pub-r2.com/exercises/squat.gif",
    isCustom: false,
  },
  {
    id: "global-deadlift",
    name: "Barbell Deadlift",
    bodyPart: "back",
    targetMuscle: "erector spinae",
    equipment: "barbell",
    gifUrl: "https://pub-r2.com/exercises/deadlift.gif",
    isCustom: false,
  },
  {
    id: "global-pullup",
    name: "Pull Up",
    bodyPart: "back",
    targetMuscle: "latissimus dorsi",
    equipment: "bodyweight",
    gifUrl: "https://pub-r2.com/exercises/pull-up.gif",
    isCustom: false,
  },
  {
    id: "global-dumbell-curl",
    name: "Dumbbell Bicep Curl",
    bodyPart: "arms",
    targetMuscle: "biceps",
    equipment: "dumbbell",
    gifUrl: "https://pub-r2.com/exercises/dumbbell-curl.gif",
    isCustom: false,
  },
  {
    id: "global-tricep-pushdown",
    name: "Tricep Pushdown",
    bodyPart: "arms",
    targetMuscle: "triceps",
    equipment: "cable",
    gifUrl: "https://pub-r2.com/exercises/tricep-pushdown.gif",
    isCustom: false,
  },
  {
    id: "global-shoulder-press",
    name: "Dumbbell Shoulder Press",
    bodyPart: "shoulders",
    targetMuscle: "deltoids",
    equipment: "dumbbell",
    gifUrl: "https://pub-r2.com/exercises/shoulder-press.gif",
    isCustom: false,
  },
  {
    id: "global-leg-press",
    name: "Leg Press",
    bodyPart: "legs",
    targetMuscle: "quadriceps",
    equipment: "machine",
    gifUrl: "https://pub-r2.com/exercises/leg-press.gif",
    isCustom: false,
  },
];

@Injectable()
export class ExercisesService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string, query: ExerciseQueryDto) {
    const customExercises = await this.prisma.exercise.findMany({
      where: {
        OR: [{ userId }, { isCustom: false }],
        ...(query.bodyPart ? { bodyPart: { equals: query.bodyPart, mode: "insensitive" } } : {}),
        ...(query.equipment ? { equipment: { equals: query.equipment, mode: "insensitive" } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { targetMuscle: { contains: query.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    });

    // Filter global exercises in-memory if query params present
    const filteredGlobals = GLOBAL_EXERCISES.filter((ex) => {
      if (query.bodyPart && ex.bodyPart.toLowerCase() !== query.bodyPart.toLowerCase()) {
        return false;
      }
      if (query.equipment && ex.equipment.toLowerCase() !== query.equipment.toLowerCase()) {
        return false;
      }
      if (
        query.search &&
        !ex.name.toLowerCase().includes(query.search.toLowerCase()) &&
        !ex.targetMuscle?.toLowerCase().includes(query.search.toLowerCase())
      ) {
        return false;
      }
      return true;
    });

    // Merge custom and global, avoiding duplicate IDs
    const customIds = new Set(customExercises.map((c) => c.id));
    const combined = [
      ...customExercises,
      ...filteredGlobals.filter((g) => !customIds.has(g.id)),
    ];

    return combined;
  }

  async create(userId: string, data: CreateExerciseDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    return this.prisma.exercise.create({
      data: {
        ...data,
        isCustom: true,
        userId,
        tenantId: user?.tenantId,
      },
    });
  }
}
