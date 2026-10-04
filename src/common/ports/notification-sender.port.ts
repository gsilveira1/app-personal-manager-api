import {
  NotificationTemplate,
  NotificationTemplateParams,
} from "../types/notification-job";

/** Injection token. Provided and exported by MessagingModule. */
export const NOTIFICATION_SENDER = Symbol("NOTIFICATION_SENDER");

export interface EnqueueNotificationRequest {
  /** Trainer whose WhatsApp instance sends the message. */
  userId: string;
  /** Recipient client; null for messages not addressed to a client. */
  clientId: string | null;
  recipientPhone: string;
  templateType: NotificationTemplate;
  params: NotificationTemplateParams;
  /** Build with `buildIdempotencyKey`. A repeated key within 24 h is not sent twice. */
  idempotencyKey: string;
  /** true = ignore the trainer's do-not-disturb window. Default false. */
  bypassDnd?: boolean;
}

export interface EnqueueNotificationResult {
  jobId: string;
  /** DUPLICATE = a job with the same idempotency key already exists; nothing was added. */
  status: "ENQUEUED" | "DUPLICATE";
  /** 0 when the job runs immediately; otherwise the wait until the do-not-disturb window ends. */
  scheduledDelayMs: number;
}

/**
 * The only way other modules send a message. The call returns once the job is in
 * Redis; delivery and the NotificationLog row happen in the worker.
 *
 * @example
 * await this.notifications.enqueue({
 *   userId, clientId: client.id, recipientPhone: client.phone,
 *   templateType: "WELCOME_ANAMNESIS", params: { name: client.name, link },
 *   idempotencyKey: buildIdempotencyKey(["WELCOME_ANAMNESIS", assessmentId]),
 * });
 */
export interface NotificationSender {
  /** @throws {ServiceUnavailableException} When the queue (Redis) cannot be reached */
  enqueue(
    request: EnqueueNotificationRequest,
  ): Promise<EnqueueNotificationResult>;
}
