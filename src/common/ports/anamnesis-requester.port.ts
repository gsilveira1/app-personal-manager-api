import { EnqueueNotificationResult } from "./notification-sender.port";

/** Injection token. Provided and exported by HealthModule. */
export const ANAMNESIS_REQUESTER = Symbol("ANAMNESIS_REQUESTER");

export interface AnamnesisRequestResult {
  assessmentId: string;
  /** Opaque magic token (Assessment.magicToken). */
  token: string;
  /** URL the student opens to fill the form. */
  link: string;
  /** Present when `notify` was true. */
  notification: EnqueueNotificationResult | null;
}

/**
 * Creates a pending ANAMNESIS assessment with a magic token and, optionally, sends the
 * link to the client over WhatsApp. Used by crm to welcome a newly created client.
 *
 * @example
 * await this.anamnesis.requestAnamnesis(userId, client.id, { notify: true });
 */
export interface AnamnesisRequester {
  /**
   * @throws {NotFoundException} When the client does not exist or is soft-deleted
   * @throws {ForbiddenException} When the client belongs to another trainer
   * @throws {ServiceUnavailableException} When `notify` is true and the queue cannot be reached
   *   (the assessment is still created; the caller decides how to report it)
   */
  requestAnamnesis(
    userId: string,
    clientId: string,
    options: { notify: boolean },
  ): Promise<AnamnesisRequestResult>;
}
