import { Inject, Injectable } from "@nestjs/common";
import { CLIENT_DIRECTORY, ClientDirectory } from "../../../common/ports";
import { PrismaService } from "../../prisma/prisma.service";
import {
  ActivityHeatmap,
  buildActivityHeatmap,
  heatmapWindowStart,
} from "./activity-heatmap";
import { HEATMAP_DEFAULT_DAYS } from "./portal.dto";

@Injectable()
export class ClientActivityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory,
  ) {}

  /**
   * Workouts the client finished in the portal over the last `days` days.
   *
   * @throws {NotFoundException | ForbiddenException} From the client ownership check
   *
   * @example
   * const heatmap = await activity.getHeatmap(userId, clientId, 30);
   */
  async getHeatmap(
    userId: string,
    clientId: string,
    days: number = HEATMAP_DEFAULT_DAYS,
  ): Promise<ActivityHeatmap> {
    await this.clients.requireOwned(userId, clientId);
    const now = new Date();
    const sessions = await this.prisma.studentSession.findMany({
      where: { clientId, completedAt: { gte: heatmapWindowStart(now, days) } },
      orderBy: { completedAt: "asc" },
      select: { completedAt: true, workoutName: true, durationSeconds: true },
    });
    return buildActivityHeatmap(clientId, sessions, days, now);
  }
}
