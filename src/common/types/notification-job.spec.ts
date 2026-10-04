import {
  buildIdempotencyKey,
  InvalidRecipientError,
  NOTIFICATION_JOB_OPTIONS,
  WhatsAppInstanceError,
  WhatsAppNotConnectedError,
  WhatsAppTransientError,
} from "./notification-job";

describe("buildIdempotencyKey", () => {
  it("is deterministic and safe as a BullMQ job id", () => {
    const key = buildIdempotencyKey(["WELCOME_ANAMNESIS", "assessment-1"]);
    expect(key).toBe(
      buildIdempotencyKey(["WELCOME_ANAMNESIS", "assessment-1"]),
    );
    expect(key).toMatch(/^[0-9a-f]{40}$/);
  });

  it("does not collide when parts are split differently", () => {
    expect(buildIdempotencyKey(["ab", "c"])).not.toBe(
      buildIdempotencyKey(["a", "bc"]),
    );
  });
});

describe("delivery errors", () => {
  it("only the transient error is retryable", () => {
    expect(new WhatsAppTransientError("timeout").retryable).toBe(true);
    expect(new WhatsAppNotConnectedError("x").retryable).toBe(false);
    expect(new WhatsAppInstanceError("x", 404).retryable).toBe(false);
    expect(new InvalidRecipientError("x").retryable).toBe(false);
  });

  it("formats the audit entry with code and HTTP status", () => {
    expect(new WhatsAppTransientError("upstream down", 503).toLogEntry()).toBe(
      "WHATSAPP_TRANSIENT (HTTP 503): upstream down",
    );
    expect(new InvalidRecipientError("empty phone").toLogEntry()).toBe(
      "INVALID_RECIPIENT: empty phone",
    );
  });

  it("keeps the subclass name for logs", () => {
    expect(new WhatsAppInstanceError("gone").name).toBe(
      "WhatsAppInstanceError",
    );
  });
});

describe("NOTIFICATION_JOB_OPTIONS", () => {
  it("retries five times with exponential backoff from 30 s", () => {
    expect(NOTIFICATION_JOB_OPTIONS.attempts).toBe(5);
    expect(NOTIFICATION_JOB_OPTIONS.backoff).toEqual({
      type: "exponential",
      delay: 30_000,
    });
  });
});
