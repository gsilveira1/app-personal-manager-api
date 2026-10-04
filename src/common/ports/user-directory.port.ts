import { AccountStatus, WhatsappStatus } from "@prisma/client";
import { ResolvedUserSettings } from "../types/user-settings";

/** Injection token. Provided and exported by IdentityModule. */
export const USER_DIRECTORY = Symbol("USER_DIRECTORY");

/** What other modules may know about a trainer. Never includes credentials. */
export interface TrainerProfile {
  id: string;
  name: string;
  phone: string | null;
  slug: string;
  status: AccountStatus;
  /** Defaults to "#10B981" when the trainer never chose one. */
  primaryColor: string;
  logoUrl: string | null;
}

export interface WhatsappConnection {
  instanceName: string | null;
  status: WhatsappStatus;
}

/**
 * The only way modules other than identity read or change the User model.
 *
 * @example
 * constructor(@Inject(USER_DIRECTORY) private readonly users: UserDirectory) {}
 */
export interface UserDirectory {
  /**
   * Resolves the trainer behind a public URL.
   * @throws {NotFoundException} When no user has that slug
   */
  requireBySlug(slug: string): Promise<TrainerProfile>;

  /** @throws {NotFoundException} When the user does not exist */
  getProfile(userId: string): Promise<TrainerProfile>;

  /**
   * Settings with defaults applied (work hours, do-not-disturb, language, limits...).
   * @throws {NotFoundException} When the user does not exist
   */
  getSettings(userId: string): Promise<ResolvedUserSettings>;

  /** @throws {NotFoundException} When the user does not exist */
  getWhatsappConnection(userId: string): Promise<WhatsappConnection>;

  /**
   * Updates `whatsappInstanceName` and/or `whatsappStatus`. Used by messaging when the
   * trainer connects or disconnects, and by the worker when the provider reports a dead instance.
   * @returns The connection after the update
   * @throws {NotFoundException} When the user does not exist
   */
  setWhatsappConnection(
    userId: string,
    patch: Partial<WhatsappConnection>,
  ): Promise<WhatsappConnection>;
}
