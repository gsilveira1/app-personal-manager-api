import { Injectable } from "@nestjs/common";
import { NotificationLog, Prisma } from "@prisma/client";
import { NotificationChannel, NotificationLogStatus } from "../../common/types";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  /** BullMQ job id = idempotency key. At most one row per job. */
  jobId: string;
  userId: string;
  clientId: string | null;
  recipientPhone: string;
  templateType: string;
  status: NotificationLogStatus;
  channel: NotificationChannel;
  error: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** The only writer of NotificationLog: one row per finished job. */
@Injectable()
export class NotificationAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts the final outcome of a job.
   *
   * @returns The new row, or `null` when a row for this job already exists
   *   (the job was re-delivered after its outcome had been recorded)
   * @throws Any database error other than the unique violation on `jobId`
   */
  async record(entry: AuditEntry): Promise<NotificationLog | null> {
    try {
      return await this.prisma.notificationLog.create({ data: entry });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  /** The audit row of a job, or `null` when its outcome has not been recorded yet. */
  findByJobId(jobId: string): Promise<NotificationLog | null> {
    return this.prisma.notificationLog.findUnique({ where: { jobId } });
  }
}
