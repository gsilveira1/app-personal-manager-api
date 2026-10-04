import { ClientStatus } from "@prisma/client";

/** Injection token. Provided and exported by ClientDirectoryModule (src/modules/crm). */
export const CLIENT_DIRECTORY = Symbol("CLIENT_DIRECTORY");

export interface ClientSummary {
  id: string;
  /** Owning trainer. */
  userId: string;
  name: string;
  email: string;
  phone: string;
  avatar: string | null;
  status: ClientStatus;
  dateOfBirth: Date | null;
  notificationEnabled: boolean;
}

/**
 * Read-only view of Client for the other modules. Soft-deleted clients do not exist
 * here: every method behaves as if they had been removed.
 *
 * @example
 * const client = await this.clients.requireOwned(userId, dto.clientId);
 */
export interface ClientDirectory {
  /**
   * Ownership check used before writing anything that belongs to a client.
   * @throws {NotFoundException} When the client does not exist or is soft-deleted
   * @throws {ForbiddenException} When the client belongs to another trainer
   */
  requireOwned(userId: string, clientId: string): Promise<ClientSummary>;

  /**
   * Lookup without a trainer in context (magic-link flows).
   * @returns null when the client does not exist or is soft-deleted
   */
  findById(clientId: string): Promise<ClientSummary | null>;

  /**
   * Batch lookup for list views (one query). Ids that are missing, deleted or owned
   * by another trainer are absent from the map.
   */
  findManyOwned(
    userId: string,
    clientIds: readonly string[],
  ): Promise<Map<string, ClientSummary>>;

  /**
   * Number of live (not soft-deleted) clients per trainer, in one query.
   * Trainers without clients are absent from the map. Used by the admin user list.
   */
  countByOwners(userIds: readonly string[]): Promise<Map<string, number>>;
}
