import { createHash } from "crypto";

/** BullMQ queue that carries every outbound message. */
export const NOTIFICATIONS_QUEUE = "notifications";
/** Name of the only job type on {@link NOTIFICATIONS_QUEUE}. */
export const SEND_NOTIFICATION_JOB = "send";

export const NOTIFICATION_TEMPLATES = [
  "WELCOME_ANAMNESIS",
  "WORKOUT_LINK",
  "EXPIRATION_ALERT",
] as const;
export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

export type NotificationChannel = "WHATSAPP" | "EMAIL";
export type NotificationLogStatus = "SENT" | "FAILED" | "CANCELLED";

/** Payload of a `send` job. Self-contained: the worker never re-reads the client. */
export interface NotificationJobData {
  version: 1;
  /** Also the BullMQ job id and `NotificationLog.jobId`. */
  idempotencyKey: string;
  /** Trainer whose WhatsApp instance sends the message. */
  userId: string;
  /** Recipient client, when there is one. */
  clientId: string | null;
  recipientPhone: string;
  channel: "WHATSAPP";
  templateType: NotificationTemplate;
  params: NotificationTemplateParams;
  /** ISO timestamp of the enqueue call. */
  requestedAt: string;
}

export interface NotificationTemplateParams {
  /** Recipient's name. */
  name: string;
  /** Magic link, for templates that carry one. */
  link?: string;
}

/**
 * Retry policy of the `send` job. Only {@link WhatsAppTransientError} is retried;
 * every other {@link NotificationDeliveryError} fails the job on the first attempt.
 * Waits between attempts: 30 s, 60 s, 120 s, 240 s.
 */
export const NOTIFICATION_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  /** Completed jobs stay 24 h so a repeated idempotency key is ignored. */
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
} as const;

/**
 * Derives a job id from the facts that make two requests "the same message".
 * BullMQ rejects ids containing ":", so the result is a hex digest.
 *
 * @param parts - e.g. `["WELCOME_ANAMNESIS", assessmentId]`
 * @returns 40 hex characters
 *
 * @example
 * buildIdempotencyKey(["WORKOUT_LINK", clientId, sheetId, "2026-10-03T14:05"])
 */
export function buildIdempotencyKey(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 40);
}

export type NotificationErrorCode =
  | "WHATSAPP_TRANSIENT"
  | "WHATSAPP_NOT_CONNECTED"
  | "WHATSAPP_INSTANCE_UNAVAILABLE"
  | "INVALID_RECIPIENT";

/** Base class of every delivery failure the worker knows how to classify. */
export abstract class NotificationDeliveryError extends Error {
  abstract readonly code: NotificationErrorCode;
  abstract readonly retryable: boolean;

  constructor(
    message: string,
    /** HTTP status returned by the provider, when there was a response. */
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }

  /** Text stored in `NotificationLog.error`. */
  toLogEntry(): string {
    const status = this.httpStatus ? ` (HTTP ${this.httpStatus})` : "";
    return `${this.code}${status}: ${this.message}`;
  }
}

/** Timeout, network error, HTTP 429 or 5xx from the provider. Retried with backoff. */
export class WhatsAppTransientError extends NotificationDeliveryError {
  readonly code = "WHATSAPP_TRANSIENT";
  readonly retryable = true;
}

/** The trainer has no connected WhatsApp instance. Not retried. */
export class WhatsAppNotConnectedError extends NotificationDeliveryError {
  readonly code = "WHATSAPP_NOT_CONNECTED";
  readonly retryable = false;
}

/** The provider says the instance is gone or logged out (HTTP 400/401/404). Not retried; the user is marked DISCONNECTED. */
export class WhatsAppInstanceError extends NotificationDeliveryError {
  readonly code = "WHATSAPP_INSTANCE_UNAVAILABLE";
  readonly retryable = false;
}

/** Empty or malformed phone number. Not retried. */
export class InvalidRecipientError extends NotificationDeliveryError {
  readonly code = "INVALID_RECIPIENT";
  readonly retryable = false;
}
