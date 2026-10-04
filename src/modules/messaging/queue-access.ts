import { Logger, ServiceUnavailableException } from "@nestjs/common";

/** How long an HTTP request waits for Redis before answering 503. */
export const QUEUE_CALL_TIMEOUT_MS = 5_000;

export const QUEUE_UNAVAILABLE_MESSAGE =
  "Fila de mensagens indisponível. Tente novamente em instantes.";

/**
 * Runs one BullMQ call on behalf of an HTTP request. BullMQ keeps commands in an
 * offline queue while Redis is down, which would hang the request, so the call is
 * raced against a timeout.
 *
 * @param action - What was being attempted, for the log line
 * @throws {ServiceUnavailableException} When the call fails or does not answer in time
 *
 * @example
 * const job = await callQueue(this.logger, `getJob ${id}`, () => queue.getJob(id));
 */
export async function callQueue<T>(
  logger: Logger,
  action: string,
  call: () => Promise<T>,
  timeoutMs: number = QUEUE_CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer from Redis in ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([call(), timeout]);
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    logger.error(
      `Notifications queue unavailable (${action}): ${cause.message}`,
      cause.stack,
    );
    throw new ServiceUnavailableException(QUEUE_UNAVAILABLE_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}
