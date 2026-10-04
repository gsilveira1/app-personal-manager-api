import { Injectable } from "@nestjs/common";
import { Exercise, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateExerciseDto,
  ExerciseQueryDto,
  ExerciseView,
} from "./exercise.dto";

function toExerciseView(exercise: Exercise): ExerciseView {
  const { userId, ...rest } = exercise;
  return { ...rest, isCustom: userId !== null };
}

function insensitiveEquals(value: string): Prisma.StringFilter {
  return { equals: value, mode: "insensitive" };
}

/**
 * Every condition is an element of one `AND`, so the search `OR` can never replace
 * the ownership `OR` (the old query spread both under the same key and leaked other
 * trainers' exercises on search).
 */
function buildCatalogueWhere(
  userId: string,
  query: ExerciseQueryDto,
): Prisma.ExerciseWhereInput {
  const conditions: Prisma.ExerciseWhereInput[] = [
    { OR: [{ userId }, { userId: null }] },
  ];
  if (query.bodyPart) {
    conditions.push({ bodyPart: insensitiveEquals(query.bodyPart) });
  }
  if (query.equipment) {
    conditions.push({ equipment: insensitiveEquals(query.equipment) });
  }
  if (query.search) {
    conditions.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { targetMuscle: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }
  return { AND: conditions };
}

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @returns The caller's private exercises plus the global catalogue, by name
   *
   * @example
   * await exercises.findAll(userId, { search: "supino", bodyPart: "chest" });
   */
  async findAll(
    userId: string,
    query: ExerciseQueryDto,
  ): Promise<ExerciseView[]> {
    const rows = await this.prisma.exercise.findMany({
      where: buildCatalogueWhere(userId, query),
      orderBy: { name: "asc" },
    });
    return rows.map(toExerciseView);
  }

  /** Creates a private exercise; global ones come from the seed only. */
  async create(userId: string, dto: CreateExerciseDto): Promise<ExerciseView> {
    const created = await this.prisma.exercise.create({
      data: { ...dto, userId },
    });
    return toExerciseView(created);
  }
}
