/**
 * Soft-delete filters for Client (the only soft-deleted model).
 * Rules: docs/api-contract-v2.md, section 7.
 */

/** Spread into every `where` on Client that must not see deleted rows. */
export const NOT_DELETED = { deletedAt: null } as const;

/**
 * Spread into a `where` on a model that belongs to a client (Assessment, WorkoutSheet,
 * StudentSession, Payment) to hide rows of deleted clients.
 *
 * @example
 * prisma.assessment.findMany({ where: { userId, ...OF_LIVE_CLIENT } })
 */
export const OF_LIVE_CLIENT = { client: NOT_DELETED } as const;

/**
 * Same as {@link OF_LIVE_CLIENT} for models where the client is optional (Event):
 * keeps rows without a client (BLOCK events) and rows of live clients.
 *
 * @example
 * prisma.event.findMany({ where: { userId, ...WITHOUT_DELETED_CLIENT } })
 */
export const WITHOUT_DELETED_CLIENT = {
  OR: [{ clientId: null }, { client: NOT_DELETED }],
};
