import { ConfigService } from "@nestjs/config";

export interface QueueRootOptions {
  connection: { url: string };
}

/**
 * BullMQ root options. `REDIS_URL` is required: without it the application
 * fails to start instead of running with a queue that can never deliver.
 *
 * @throws {Error} When `REDIS_URL` is not set
 *
 * @example
 * BullModule.forRootAsync({ inject: [ConfigService], useFactory: buildQueueRootOptions })
 */
export function buildQueueRootOptions(config: ConfigService): QueueRootOptions {
  const url = config.get<string>("REDIS_URL");
  if (!url) {
    throw new Error(
      "REDIS_URL is required: the notifications queue (BullMQ) cannot start without Redis.",
    );
  }
  return { connection: { url } };
}
