import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Awaits a write whose `where` carries the owner (`{ id, userId }`). When the row is
 * gone or no longer belongs to the caller, Prisma fails with P2025; that becomes a 404
 * so the caller learns nothing about rows of other trainers.
 *
 * @example
 * await ownedWrite(prisma.event.delete({ where: { id, userId } }), "Block not found");
 *
 * @throws {NotFoundException} When the write matched no row (P2025)
 */
export async function ownedWrite<T>(
  write: Promise<T>,
  notFoundMessage: string,
): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new NotFoundException(notFoundMessage);
    }
    throw error;
  }
}
